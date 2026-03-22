/**
 * EntityListScreen — displays entity records split by purpose.
 * 
 * - Billing records: read-only, badge, link to /settings/legal-details
 * - Active document records: click to edit, archive button
 * - Archived document records: collapsed section
 * 
 * Billing cards have NO edit/archive buttons and NO click-to-edit behavior.
 */

import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Building2,
  Plus,
  Archive,
  ExternalLink,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import { Link } from "react-router-dom";
import { useState } from "react";

interface EntityListScreenProps {
  billingEntities: ClientLegalDetails[];
  activeDocumentEntities: ClientLegalDetails[];
  archivedDocumentEntities: ClientLegalDetails[];
  isLoading: boolean;
  isArchiving: boolean;
  onCreateNew: () => void;
  onEdit: (entity: ClientLegalDetails) => void;
  onArchive: (id: string) => void;
}

/** Get display name from entity based on client_type */
function getEntityName(entity: ClientLegalDetails): string {
  if (entity.client_type === "entrepreneur") {
    return entity.ent_name || "ИП без названия";
  }
  return entity.leg_name || "Организация без названия";
}

function getEntityUnp(entity: ClientLegalDetails): string | null {
  return entity.client_type === "entrepreneur" ? entity.ent_unp : entity.leg_unp;
}

function getEntityOrgForm(entity: ClientLegalDetails): string | null {
  if (entity.client_type === "entrepreneur") return "ИП";
  return entity.leg_org_form || null;
}

function EntityCard({
  entity,
  isReadOnly,
  onEdit,
  onArchive,
  isArchiving,
}: {
  entity: ClientLegalDetails;
  isReadOnly: boolean;
  onEdit?: (entity: ClientLegalDetails) => void;
  onArchive?: (id: string) => void;
  isArchiving?: boolean;
}) {
  const name = getEntityName(entity);
  const unp = getEntityUnp(entity);
  const orgForm = getEntityOrgForm(entity);

  return (
    <GlassCard
      className={`flex flex-col gap-2 ${!isReadOnly ? "cursor-pointer" : ""}`}
      hover={!isReadOnly}
      onClick={!isReadOnly && onEdit ? () => onEdit(entity) : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {orgForm && (
            <Badge variant="outline" className="text-xs">
              {orgForm}
            </Badge>
          )}
          {isReadOnly && (
            <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20">
              Платёжные
            </Badge>
          )}
          {entity.status === "archived" && (
            <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
              Архив
            </Badge>
          )}
        </div>
      </div>

      {unp && (
        <p className="text-xs text-muted-foreground">УНП: {unp}</p>
      )}

      {isReadOnly && (
        <Link
          to="/settings/legal-details"
          className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          Редактировать в настройках
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}

      {!isReadOnly && entity.status === "active" && onArchive && (
        <div className="flex justify-end mt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(entity.id);
            }}
            disabled={isArchiving}
          >
            {isArchiving ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Archive className="h-3 w-3 mr-1" />
            )}
            В архив
          </Button>
        </div>
      )}
    </GlassCard>
  );
}

export function EntityListScreen({
  billingEntities,
  activeDocumentEntities,
  archivedDocumentEntities,
  isLoading,
  isArchiving,
  onCreateNew,
  onEdit,
  onArchive,
}: EntityListScreenProps) {
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAny = billingEntities.length > 0 || activeDocumentEntities.length > 0 || archivedDocumentEntities.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Юрлица / ИП</h2>
        <Button onClick={onCreateNew} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Добавить
        </Button>
      </div>

      {/* Billing section */}
      {billingEntities.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Платёжные реквизиты
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {billingEntities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                isReadOnly
              />
            ))}
          </div>
        </div>
      )}

      {/* Active document entities */}
      {activeDocumentEntities.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Для документов
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {activeDocumentEntities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                isReadOnly={false}
                onEdit={onEdit}
                onArchive={onArchive}
                isArchiving={isArchiving}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasAny && (
        <GlassCard className="text-center py-12">
          <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
            <Building2 className="h-8 w-8 text-indigo-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет реквизитов</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Добавьте реквизиты организации или ИП для автозаполнения документов.
          </p>
          <Button onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить реквизиты
          </Button>
        </GlassCard>
      )}

      {/* Archived section */}
      {archivedDocumentEntities.length > 0 && (
        <Collapsible open={archiveOpen} onOpenChange={setArchiveOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${archiveOpen ? "rotate-180" : ""}`} />
              Архив ({archivedDocumentEntities.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {archivedDocumentEntities.map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  isReadOnly={false}
                  onEdit={onEdit}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
