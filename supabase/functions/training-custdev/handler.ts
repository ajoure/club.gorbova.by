import type {
  CustdevDb,
  SavedVersion,
  StoredRun,
  Workspace,
} from "../_shared/custdev-storage.ts";
import {
  canonical,
  emptyState,
  validateState,
} from "../_shared/custdev-contract.ts";
import { loadSources } from "../_shared/custdev-sources.ts";
import {
  AI_MODEL,
  type AiAction,
  applyAiResult,
  completionIssues,
  hashesFor,
  normalizeUserState,
  prepareAi,
  validateAiOutput,
} from "../_shared/custdev-workspace.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { wordingSourceRequest } from "./wording-sources.ts";

export const CUSTDEV_RELEASE = "bkb-step5-wording-sources-v3";

export interface Dependencies {
  db: CustdevDb;
  callAi: (prompt: string) => Promise<unknown>;
}
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "X-Custdev-Release": CUSTDEV_RELEASE,
    },
  });
const fail = (message: string, status = 400): never => {
  throw Object.assign(new Error(message), { httpStatus: status });
};

export async function handleCustdev(
  req: Request,
  deps: Dependencies,
): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return response({ error: "method_not_allowed" }, 405);
    }
    const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)
      ?.[1];
    if (!bearer) return response({ error: "Требуется вход в кабинет" }, 401);
    const auth = await deps.db.auth.getUser(bearer);
    if (auth.error || !auth.data?.user?.id) {
      return response({ error: "Сессия недействительна" }, 401);
    }
    const actor = auth.data.user.id;
    const raw = await req.text();
    if (raw.length > 2_100_000) {
      return response({ error: "Слишком большой документ" }, 413);
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return response({ error: "Неверный документ" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return response({ error: "Неверный JSON" }, 400);
    }
    if (
      !uuid(body.lessonId) || !uuid(body.blockId) ||
      (body.ownerId && !uuid(body.ownerId))
    ) return response({ error: "Неверный идентификатор урока" }, 400);
    const roles = await Promise.all(
      ["admin", "super_admin"].map((role) =>
        deps.db.rpc("has_role_v2", { _user_id: actor, _role_code: role })
      ),
    );
    if (roles.some((r) => r.error)) {
      return response({ error: "Не удалось проверить права" }, 503);
    }
    const isAdmin = roles.some((r) => r.data === true),
      owner = typeof body.ownerId === "string" ? body.ownerId : actor;
    if (owner !== actor && !isAdmin) {
      return response({ error: "Доступ к чужим ответам запрещён" }, 403);
    }
    const [lessonResult, blockResult] = await Promise.all([
      deps.db.from<{ id: string; module_id: string; sort_order: number }>(
        "training_lessons",
      ).select("id,module_id,sort_order").eq(
        "id",
        body.lessonId,
      ).maybeSingle(),
      deps.db.from<
        {
          id: string;
          lesson_id: string;
          block_type: string;
          content: Record<string, unknown>;
        }
      >("lesson_blocks").select("id,lesson_id,block_type,content")
        .eq("id", body.blockId).maybeSingle(),
    ]);
    const lesson = lessonResult.data, block = blockResult.data;
    if (lessonResult.error || blockResult.error) {
      return response({ error: "Ошибка чтения урока" }, 503);
    }
    if (
      !lesson || !block || block.lesson_id !== lesson.id ||
      block.block_type !== "custdev_workshop"
    ) return response({ error: "Блок задания не найден" }, 404);
    if (!isAdmin) {
      const access = await deps.db.rpc("user_has_training_lesson_access", {
        _user_id: actor,
        _lesson_id: lesson.id,
      });
      if (access.error || access.data !== true) {
        return response({ error: "Нет доступа к уроку" }, 403);
      }
    }
    const read = await deps.db.from<Workspace>("training_custdev_workspaces")
      .select("*")
      .eq("user_id", owner).eq("block_id", block.id).maybeSingle();
    if (read.error) {
      return response({ error: "Хранилище задания пока недоступно" }, 503);
    }
    const workspace = read.data, state = workspace?.state ?? emptyState();
    validateState(state);
    const sources = await loadSources(
      deps.db,
      owner,
      lesson,
      block.content ?? {},
    );
    const hashes = await hashesFor(state, sources);
    const history = async (runsOffset = 0, versionsOffset = 0) => {
      if (!workspace) {
        return {
          runs: [],
          versions: [],
          historyMore: { runs: false, versions: false },
        };
      }
      const [runs, versions] = await Promise.all([
        deps.db.from<StoredRun>("training_custdev_ai_runs").select(
          "id,action,segment_id,target_id,source_hash,status,created_at,model_name,error_code",
        ).eq("workspace_id", workspace.id).order("created_at", {
          ascending: false,
        }).order("id", { ascending: false }).range(runsOffset, runsOffset + 39),
        deps.db.from<SavedVersion>("training_custdev_versions").select(
          "id,revision,status,review_notes,created_at",
        ).eq("workspace_id", workspace.id).order("revision", {
          ascending: false,
        }).range(versionsOffset, versionsOffset + 29),
      ]);
      if (runs.error || versions.error) {
        throw new Error("Не удалось прочитать историю");
      }
      return {
        runs: runs.data,
        versions: versions.data,
        historyMore: {
          runs: runs.data?.length === 40,
          versions: versions.data?.length === 30,
        },
      };
    };
    if (body.action === "load") {
      return response({
        workspace,
        state,
        sources,
        hashes,
        isAdmin,
        canEdit: owner === actor,
        ...await history(),
      });
    }
    if (body.action === "history") {
      const r = body.runsOffset, v = body.versionsOffset;
      if (
        !Number.isInteger(r) || !Number.isInteger(v) || Number(r) < 0 ||
        Number(v) < 0 || Number(r) > 1000000 || Number(v) > 1000000
      ) return response({ error: "Неверная страница истории" }, 400);
      return response(await history(Number(r), Number(v)));
    }
    if (body.action === "version") {
      if (!workspace || !uuid(body.versionId)) {
        return response({ error: "Версия не найдена" }, 404);
      }
      const r = await deps.db.from<SavedVersion>("training_custdev_versions")
        .select("*").eq(
          "workspace_id",
          workspace.id,
        ).eq("id", body.versionId).maybeSingle();
      return r.error || !r.data
        ? response({ error: "Версия не найдена" }, 404)
        : response({ version: r.data });
    }
    if (body.action === "run") {
      if (!workspace || !uuid(body.runId)) {
        return response({ error: "Версия анализа не найдена" }, 404);
      }
      const r = await deps.db.from<StoredRun>("training_custdev_ai_runs")
        .select("*").eq(
          "workspace_id",
          workspace.id,
        ).eq("id", body.runId).maybeSingle();
      return r.error || !r.data
        ? response({ error: "Версия анализа не найдена" }, 404)
        : response({ run: r.data });
    }
    if (owner !== actor && body.action !== "review") {
      return response({
        error: "Администратор проверяет результат, не изменяя ответы ученика",
      }, 403);
    }
    if (
      !Number.isInteger(body.expectedRevision) ||
      body.expectedRevision !== (workspace?.revision ?? 0)
    ) {
      return response({
        error:
          "Задание изменено в другой вкладке. Ваш текст сохранён в локальном черновике; обновите данные и сравните версии",
        code: "revision_conflict",
      }, 409);
    }
    const save = async (
      next: unknown,
      submit = false,
      review: string | null = null,
    ) => {
      const result = await deps.db.rpc<Workspace>("custdev_save_workspace", {
        p_actor: actor,
        p_owner: owner,
        p_lesson: lesson.id,
        p_block: block.id,
        p_expected: body.expectedRevision,
        p_state: next,
        p_submit: submit,
        p_review: review,
        p_notes: typeof body.notes === "string" ? body.notes : "",
      });
      if (result.error) {
        if (result.error.code === "40001") {
          fail(
            "Конфликт версий: обновите данные, локальный черновик сохранён",
            409,
          );
        }
        fail("Не удалось сохранить задание", 503);
      }
      return result.data;
    };
    if (body.action === "save" || body.action === "submit") {
      const next = await normalizeUserState(body.state, state, sources),
        nextHashes = await hashesFor(next, sources);
      if (body.action === "submit") {
        const issues = completionIssues(next, nextHashes);
        if (issues.length) return response({ error: issues.join(". ") }, 400);
      }
      const saved = await save(next, body.action === "submit");
      return response({ workspace: saved, state: next, hashes: nextHashes });
    }
    if (body.action === "review") {
      if (
        !isAdmin || !workspace ||
        !["approved", "changes_requested"].includes(String(body.status))
      ) return response({ error: "Проверять может только администратор" }, 403);
      const saved = await save(state, false, String(body.status));
      return response({ workspace: saved, state, hashes });
    }
    if (body.action === "ai") {
      const action = body.aiAction as AiAction;
      if (
        !workspace || !uuid(body.requestId) ||
        !["quotes", "needs", "company", "positioning", "usp"].includes(action)
      ) return response({ error: "Неверное действие ИИ" }, 400);
      const sid = typeof body.segmentId === "string" ? body.segmentId : null,
        target = typeof body.targetId === "string" ? body.targetId : null;
      const prepared = await prepareAi(state, sources, action, sid, target);
      const reserved = await deps.db.rpc<{ run: StoredRun; replayed: boolean }>(
        "custdev_reserve_ai_run",
        {
          p_actor: actor,
          p_workspace: workspace.id,
          p_request: body.requestId,
          p_action: action,
          p_segment: sid,
          p_target: target,
          p_hash: prepared.inputHash,
          p_revision: body.expectedRevision,
          p_model: AI_MODEL,
        },
      );
      if (reserved.error) {
        return response({
          error: reserved.error.code === "54000"
            ? "Достигнут защитный лимит запусков ИИ. Попробуйте позже; ответы сохранены"
            : "Не удалось зарезервировать запуск ИИ",
        }, reserved.error.code === "54000" ? 429 : 409);
      }
      if (!reserved.data) fail("Не удалось зарезервировать запуск", 503);
      const run = reserved.data!.run;
      if (reserved.data!.replayed) {
        return response(
          { run, replayed: true },
          run.status === "running" ? 202 : 200,
        );
      }
      try {
        const request = wordingSourceRequest(
          prepared.prompt,
          action,
          sid,
          state,
          sources,
          hashes,
        );
        const output = await validateAiOutput(
          request.decode(await deps.callAi(request.prompt)),
          state,
          sources,
          action,
          sid,
          target,
        );
        const result = {
          output,
          baseHash: prepared.baseHash,
          inputHash: prepared.inputHash,
        };
        const updated = await deps.db.from<StoredRun>(
          "training_custdev_ai_runs",
        ).update({
          status: "succeeded",
          result,
          finished_at: new Date().toISOString(),
        }).eq("id", run.id).eq("status", "running").select("*").single();
        if (updated.error) throw new Error("Сбой сохранения версии ИИ");
        return response({ run: updated.data });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "Ошибка анализа";
        await deps.db.from<StoredRun>("training_custdev_ai_runs").update({
          status: "failed",
          error_code: "ai_result_rejected",
          finished_at: new Date().toISOString(),
        }).eq("id", run.id).eq("status", "running");
        // Only the bounded, user-readable validation error; no provider body, prompt or transcripts.
        return response({
          error: message.slice(0, 240),
          code: "ai_failed",
          runId: run.id,
        }, 502);
      }
    }
    if (body.action === "apply") {
      if (
        !workspace || !uuid(body.runId) || typeof body.preserve !== "boolean" ||
        (!body.preserve && body.confirmReplace !== true)
      ) return response({ error: "Подтвердите режим применения анализа" }, 400);
      const r = await deps.db.from<StoredRun>("training_custdev_ai_runs")
        .select("*").eq(
          "id",
          body.runId,
        ).eq("workspace_id", workspace.id).maybeSingle();
      if (r.error || r.data?.status !== "succeeded" || !r.data.result) {
        return response({ error: "Нет готовой версии ИИ" }, 404);
      }
      const run = r.data!,
        prepared = await prepareAi(
          state,
          sources,
          run.action,
          run.segment_id,
          run.target_id,
        );
      if (
        prepared.inputHash !== run.source_hash ||
        prepared.inputHash !== run.result!.inputHash
      ) {
        return response({
          error:
            "Исходные данные изменились. Сохранённая версия ИИ доступна в истории; для применения запустите новый анализ",
        }, 409);
      }
      const next = applyAiResult(
          state,
          { ...run, result: run.result! },
          body.preserve,
        ),
        saved = await save(next);
      return response({
        workspace: saved,
        state: next,
        hashes: await hashesFor(next, sources),
      });
    }
    return response({ error: "Неизвестное действие" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка задания";
    return response(
      { error: message.slice(0, 240) },
      (error as { httpStatus?: number })?.httpStatus ?? 400,
    );
  }
}
