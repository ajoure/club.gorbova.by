# Word pagination acceptance fix

Scope: frontend DOCX exporter only. No database, prompts, authorization,
Edge Functions, dependencies, model or customer data changes.

The actual production download supplied for acceptance rendered as five pages.
Section headings were stranded at page ends and approval was alone on page five.
The file was first-draft version1.0, not the revised version1.1; this is not proof
that chat revisions or local editor changes were lost by the exporter.

Fix: ignore empty Markdown lines, keep headings with the next paragraph,
keep individual paragraphs together, preserve widow control, keep a short
approval section together (at most12 nonempty paragraphs), black heading styles.
Long approval sections are not chained into an unbounded page-height block.
Formatting must never alter factual content or fill placeholders.

Verification: focused OOXML tests, TypeScript/build, local fixture reconstructed
from the submitted export's text, headings, bullets and bold runs, bundled renderer
and every-page visual review. This is local regression evidence, not a new
production download. Original supplied file is not overwritten or committed.

Release: green GitHub checks, exact merged SHA through Lovable Cloud, then Publish.
No managed migrations or function deploy. Published UI desktop/mobile checks and
actual new DOCX download/render still required before closing sprint acceptance.

Rollback: revert this frontend patch through a separate PR and normal Publish.
