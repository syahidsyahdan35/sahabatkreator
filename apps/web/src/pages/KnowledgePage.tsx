import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { KbDocumentResponse } from "@sahabat-kreator/contracts";
import {
  formatNumber,
  type Locale,
  type TranslationKey,
} from "@sahabat-kreator/i18n";
import { api } from "../api/client";
import { translateApiError } from "../api/errorText";
import { FieldError, inputClassName } from "../components/AuthLayout";
import { formatDateTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

interface KnowledgePageProps {
  t: Translate;
  locale: Locale;
}

/**
 * Halaman Knowledge Base (Fase 3B): dokumen teks workspace aktif lewat API 3A
 * — daftar (judul, jumlah chunk, waktu), tambah, lihat isi, hapus dengan
 * konfirmasi. Dokumen di-chunk otomatis di server; agent mencarinya saat
 * menjawab (retrieval full-text Fase 3A). Semua teks lewat i18n.
 */
export function KnowledgePage({ t, locale }: KnowledgePageProps) {
  const { status, tenants, active, reload } = useWorkspace();
  const tenantId = active?.id ?? null;

  const [documents, setDocuments] = useState<KbDocumentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState<KbDocumentResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KbDocumentResponse | null>(
    null,
  );
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await api.kb.listDocuments(tenantId);
      if (requestSeq.current !== seq) return;
      setDocuments(list);
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setError(translateApiError(t, err));
      setDocuments([]);
    } finally {
      if (requestSeq.current === seq) setLoading(false);
    }
  }, [tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("knowledge.title")}</h1>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error") {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("knowledge.title")}</h1>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <p className="text-sm text-danger">{t("workspace.loadError")}</p>
          <button
            type="button"
            onClick={() => void reload()}
            className="mt-3 rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("common.retry")}
          </button>
        </div>
      </section>
    );
  }
  if (tenants.length === 0 || !active) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-ink">{t("knowledge.title")}</h1>
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink">{t("workspace.emptyTitle")}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{t("workspace.emptyBody")}</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{t("knowledge.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("knowledge.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          {t("knowledge.addButton")}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-elevated p-4">
        <p className="text-xs leading-relaxed text-muted">
          {t("knowledge.chunkNote")}
        </p>
      </div>

      <FieldError message={error} />

      {loading ? (
        <p className="mt-6 text-sm text-muted">{t("common.loading")}</p>
      ) : documents.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <h2 className="text-base font-semibold text-ink">
            {t("knowledge.emptyTitle")}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("knowledge.emptyBody")}
          </p>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            {t("knowledge.addButton")}
          </button>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {doc.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {t("knowledge.chunksLabel", {
                      count: formatNumber(doc.chunkCount, locale),
                    })}
                    {" · "}
                    {t("knowledge.createdLabel", {
                      date: formatDateTime(doc.createdAt, locale),
                    })}
                  </span>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted">
                {doc.content}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setViewTarget(doc)}
                  className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-ink"
                >
                  {t("common.view")}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(doc)}
                  className="rounded-lg bg-elevated px-3 py-1.5 text-xs font-medium text-danger"
                >
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <DocumentFormModal
          t={t}
          tenantId={active.id}
          onClose={() => setFormOpen(false)}
          onSaved={(saved) => {
            setFormOpen(false);
            setDocuments((prev) => [saved, ...prev]);
          }}
        />
      ) : null}

      {viewTarget ? (
        <DocumentViewModal
          t={t}
          locale={locale}
          tenantId={active.id}
          document={viewTarget}
          onClose={() => setViewTarget(null)}
        />
      ) : null}

      {deleteTarget ? (
        <DocumentDeleteModal
          t={t}
          tenantId={active.id}
          document={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => {
            setDeleteTarget(null);
            setDocuments((prev) => prev.filter((d) => d.id !== id));
          }}
        />
      ) : null}
    </section>
  );
}

function DocumentFormModal({
  t,
  tenantId,
  onClose,
  onSaved,
}: {
  t: Translate;
  tenantId: string;
  onClose: () => void;
  onSaved: (doc: KbDocumentResponse) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return setError(t("knowledge.docTitleRequired"));
    if (!content.trim()) return setError(t("knowledge.contentRequired"));
    setError(null);
    setSubmitting(true);
    try {
      const saved = await api.kb.createDocument(tenantId, {
        title: trimmedTitle,
        content: content.trim(),
      });
      onSaved(saved);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">
            {t("knowledge.addTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("knowledge.docTitleLabel")} *
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("knowledge.docTitlePlaceholder")}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {t("knowledge.contentLabel")} *
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("knowledge.contentPlaceholder")}
              rows={10}
              className={inputClassName}
            />
            <span className="mt-1 block text-[11px] text-muted">
              {t("knowledge.chunkNote")}
            </span>
          </label>
          <FieldError message={error} />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? t("knowledge.creating") : t("knowledge.createButton")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DocumentViewModal({
  t,
  locale,
  tenantId,
  document,
  onClose,
}: {
  t: Translate;
  locale: Locale;
  tenantId: string;
  document: KbDocumentResponse;
  onClose: () => void;
}) {
  const [full, setFull] = useState<KbDocumentResponse>(document);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Ambil versi segar dari API (GET /kb/documents/:id) agar isi & jumlah
        // chunk yang tampil selalu yang tersimpan di server.
        const fresh = await api.kb.getDocument(tenantId, document.id);
        if (!cancelled) setFull(fresh);
      } catch (err) {
        if (!cancelled) setError(translateApiError(t, err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, document.id, t]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink">{full.title}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {t("knowledge.chunksLabel", {
                count: formatNumber(full.chunkCount, locale),
              })}
              {" · "}
              {t("knowledge.createdLabel", {
                date: formatDateTime(full.createdAt, locale),
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-3 py-1.5 text-sm font-medium text-ink"
          >
            {t("common.close")}
          </button>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-muted">{t("common.loading")}</p>
        ) : error ? (
          <p className="mt-4 text-sm text-danger">
            {t("knowledge.viewLoadError")} {error}
          </p>
        ) : (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {full.content}
          </p>
        )}
      </div>
    </div>
  );
}

function DocumentDeleteModal({
  t,
  tenantId,
  document,
  onClose,
  onDeleted,
}: {
  t: Translate;
  tenantId: string;
  document: KbDocumentResponse;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await api.kb.deleteDocument(tenantId, document.id);
      onDeleted(document.id);
    } catch (err) {
      setError(translateApiError(t, err));
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <h2 className="text-lg font-bold text-ink">{t("knowledge.deleteTitle")}</h2>
        <p className="mt-2 text-sm text-muted">
          {t("knowledge.deleteBody", { title: document.title })}
        </p>
        <FieldError message={error} />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {deleting ? t("knowledge.deleting") : t("common.delete")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-elevated px-4 py-2 text-sm font-medium text-ink"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
