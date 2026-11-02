import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  AutomationResponse,
  FlowGraph,
  FlowGraphIssue,
  FlowNodeType,
  FlowResponse,
  FlowRunResponse,
  FlowRunStepResponse,
} from "@sahabat-kreator/contracts";
import type { Locale, TranslationKey } from "@sahabat-kreator/i18n";
import { api, ApiClientError } from "../api/client";
import { translateApiError } from "../api/errorText";
import { formatDateTime } from "../utils/format";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { usePolling } from "../hooks/usePolling";
import {
  ADDABLE_NODE_TYPES,
  FLOW_NODE_LABEL_KEYS,
  defaultNodeConfig,
  issuesFromError,
  splitIssues,
  summarizeNodeConfig,
  translateFlowIssue,
} from "../flows/graphModel";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

// ---------------------------------------------------------------------------
// Model kanvas: node/edge React Flow adalah representasi kerja dari graf
// kontrak. Konversi dua arah di sini adalah SATU-SATUNYA tempat pemetaan
// itu tinggal — yang disimpan ke server selalu FlowGraph kontrak persis
// (termasuk `position` per node).
// ---------------------------------------------------------------------------

interface FlowNodeData extends Record<string, unknown> {
  nodeType: FlowNodeType;
  config: Record<string, unknown>;
  issueSeverity: "error" | "warning" | null;
}

type FlowRfNode = Node<FlowNodeData, "flowNode">;
type FlowRfEdge = Edge<{ branch?: "yes" | "no" }>;

interface BuilderShared {
  t: Translate;
  readOnly: boolean;
  sequenceName: (automationId: string) => string | undefined;
}

const BuilderCtx = createContext<BuilderShared | null>(null);

function useBuilderShared(): BuilderShared {
  const ctx = useContext(BuilderCtx);
  if (!ctx) throw new Error("FlowNodeCard di luar BuilderCtx");
  return ctx;
}

const NODE_ICON_PATHS: Record<FlowNodeType, string> = {
  trigger: "M13 2.5 4.5 14H11l-1 7.5L18.5 10H12l1-7.5z",
  send_message: "M21 3 10.5 13.5M21 3l-6.8 18-3.7-8.3L2.2 9 21 3z",
  condition: "M12 3.5 20 12l-8 8.5L4 12l8-8.5z",
  delay: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.2 2",
  add_tag: "M3.5 3.5H12L20.5 12 12 20.5 3.5 12V3.5zM7.5 7.5h.01",
  remove_tag: "M3.5 3.5H12L20.5 12 12 20.5 3.5 12V3.5zM7.5 7.5h.01M15.5 15.5h4",
  set_stage: "M5.5 21.5v-17M5.5 4.8h10.8l-2.2 3.6 2.2 3.6H5.5",
  enroll_sequence:
    "M8.5 6h12M8.5 12h12M8.5 18h12M3.8 6h.01M3.8 12h.01M3.8 18h.01",
  ai_response:
    "M12 3v2.5M5.5 11a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7zM9.3 13.5h.01M14.7 13.5h.01M9.5 16.8h5",
  handoff:
    "M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 19.5c.7-3.1 3.1-4.8 6-4.8s5.3 1.7 6 4.8",
  end: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.2 9.2h5.6v5.6H9.2z",
};

/** Node kustom kanvas: label tipe dwibahasa + ringkasan config satu baris. */
function FlowNodeCard({ data, selected }: NodeProps<FlowRfNode>) {
  const { t, sequenceName } = useBuilderShared();
  const type = data.nodeType;
  const summary = summarizeNodeConfig(
    t,
    { type, config: data.config },
    sequenceName,
  );
  const borderClass =
    data.issueSeverity === "error"
      ? "border-danger"
      : data.issueSeverity === "warning"
        ? "border-warning"
        : selected
          ? "border-accent"
          : "border-line";
  return (
    <div
      className={`w-[228px] rounded-xl border-2 bg-surface shadow-sm ${borderClass}`}
    >
      {type !== "trigger" ? (
        <Handle type="target" position={Position.Top} />
      ) : null}
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
            type === "trigger"
              ? "bg-accent text-white"
              : type === "condition"
                ? "bg-warning/15 text-warning"
                : "bg-elevated text-muted"
          }`}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden={true}
          >
            <path d={NODE_ICON_PATHS[type]} />
          </svg>
        </span>
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-ink">
          {t(FLOW_NODE_LABEL_KEYS[type])}
        </span>
      </div>
      {summary ? (
        <p className="px-3 pb-2.5 pt-1 text-xs leading-snug text-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
          {summary}
        </p>
      ) : (
        <div className="pb-2.5" />
      )}
      {type === "condition" ? (
        <>
          <div className="flex items-center justify-between px-8 pb-1 text-[10px] font-semibold">
            <span className="text-success">{t("flows.branchYes")}</span>
            <span className="text-danger">{t("flows.branchNo")}</span>
          </div>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            style={{ left: "28%" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            style={{ left: "72%" }}
          />
        </>
      ) : type !== "end" ? (
        <Handle type="source" position={Position.Bottom} />
      ) : null}
    </div>
  );
}

const NODE_TYPES = { flowNode: FlowNodeCard };

/**
 * Layout awal deterministik untuk node TANPA position tersimpan
 * (flow 8A yang dibuat via API): kedalaman BFS dari trigger menjadi
 * kolom x, urutan dalam kedalaman menjadi baris y. Node ber-position
 * tidak diganggu.
 */
function autoLayout(graph: FlowGraph): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const depth = new Map<string, number>();
  if (trigger) {
    depth.set(trigger.id, 0);
    const queue = [trigger.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of graph.edges.filter((x) => x.from === current)) {
        if (!depth.has(e.to)) {
          depth.set(e.to, (depth.get(current) ?? 0) + 1);
          queue.push(e.to);
        }
      }
    }
  }
  const perDepth = new Map<number, number>();
  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? (graph.nodes.indexOf(node) + 1);
    const row = perDepth.get(d) ?? 0;
    perDepth.set(d, row + 1);
    result.set(node.id, { x: d * 290, y: row * 180 });
  }
  return result;
}

function graphToRf(graph: FlowGraph): { nodes: FlowRfNode[]; edges: FlowRfEdge[] } {
  const layout = autoLayout(graph);
  const nodes: FlowRfNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "flowNode",
    position: node.position ?? layout.get(node.id) ?? { x: 0, y: 0 },
    data: {
      nodeType: node.type,
      config: node.config ?? {},
      issueSeverity: null,
    },
    draggable: true,
    deletable: node.type !== "trigger",
  }));
  const edges: FlowRfEdge[] = graph.edges.map((edge, i) => ({
    id: `e-${edge.from}-${edge.branch ?? "next"}-${edge.to}-${i}`,
    source: edge.from,
    target: edge.to,
    ...(edge.branch ? { sourceHandle: edge.branch } : {}),
    data: edge.branch ? { branch: edge.branch } : {},
  }));
  return { nodes, edges };
}

function rfToGraph(nodes: FlowRfNode[], edges: FlowRfEdge[]): FlowGraph {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      config: node.data.config,
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
    })),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      ...(edge.data?.branch ? { branch: edge.data.branch } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------

const KNOWN_STAGES = ["new", "contacted", "qualified", "customer", "lost"];

function stageLabel(t: Translate, stage: string): string {
  return KNOWN_STAGES.includes(stage)
    ? t(`contacts.stages.${stage}` as TranslationKey)
    : stage;
}

interface TenantMeta {
  tags: string[];
  stages: string[];
  sequences: AutomationResponse[];
}

interface NodeConfigPanelProps {
  t: Translate;
  node: FlowRfNode;
  meta: TenantMeta;
  readOnly: boolean;
  onChange: (nodeId: string, config: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60";
const labelClass = "block text-sm font-medium text-ink";

/** Panel konfigurasi per tipe node — bentuknya persis kontrak 8A. */
function NodeConfigPanel({
  t,
  node,
  meta,
  readOnly,
  onChange,
  onDelete,
}: NodeConfigPanelProps) {
  const type = node.data.nodeType;
  const config = node.data.config;
  const set = (patch: Record<string, unknown>) =>
    onChange(node.id, { ...config, ...patch });
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const stageOptions = useMemo(() => {
    const set = new Set<string>([...KNOWN_STAGES, ...meta.stages]);
    return [...set];
  }, [meta.stages]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t(FLOW_NODE_LABEL_KEYS[type])}
        </h3>
        {type !== "trigger" && !readOnly ? (
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="rounded-lg border border-danger px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10"
          >
            {t("flows.deleteNode")}
          </button>
        ) : null}
      </div>

      {type === "trigger" ? (
        <>
          <p className="text-xs text-muted">{t("flows.triggerLockedNote")}</p>
          <div>
            <span className={labelClass}>{t("flows.triggerKindLabel")}</span>
            <div className="mt-2 space-y-1.5">
              {(
                [
                  ["keyword", "flows.triggerKindKeyword"],
                  ["any_message", "flows.triggerKindAny"],
                ] as const
              ).map(([kind, key]) => (
                <label
                  key={kind}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="radio"
                    name="trigger-kind"
                    disabled={readOnly}
                    checked={
                      (config.kind as string | undefined) === kind ||
                      (kind === "keyword" && config.kind === undefined)
                    }
                    onChange={() =>
                      set(
                        kind === "keyword"
                          ? {
                              kind: "keyword",
                              keywords: Array.isArray(config.keywords)
                                ? config.keywords
                                : [],
                              match:
                                config.match === "contains"
                                  ? "contains"
                                  : "exact",
                            }
                          : { kind: "any_message" },
                      )
                    }
                  />
                  {t(key)}
                </label>
              ))}
            </div>
          </div>
          {config.kind !== "any_message" ? (
            <>
              <div>
                <label className={labelClass} htmlFor="cfg-keywords">
                  {t("flows.triggerKeywordsLabel")}
                </label>
                <textarea
                  id="cfg-keywords"
                  className={inputClass}
                  rows={3}
                  disabled={readOnly}
                  value={
                    Array.isArray(config.keywords)
                      ? config.keywords
                          .filter((k): k is string => typeof k === "string")
                          .join("\n")
                      : ""
                  }
                  onChange={(e) =>
                    set({
                      keywords: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <p className="mt-1 text-xs text-muted">
                  {t("flows.triggerKeywordsHint")}
                </p>
              </div>
              <div>
                <label className={labelClass} htmlFor="cfg-match">
                  {t("flows.triggerMatchLabel")}
                </label>
                <select
                  id="cfg-match"
                  className={inputClass}
                  disabled={readOnly}
                  value={config.match === "contains" ? "contains" : "exact"}
                  onChange={(e) => set({ match: e.target.value })}
                >
                  <option value="exact">{t("flows.matchExact")}</option>
                  <option value="contains">{t("flows.matchContains")}</option>
                </select>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {type === "send_message" ? (
        <div>
          <label className={labelClass} htmlFor="cfg-text">
            {t("flows.sendTextLabel")}
          </label>
          <textarea
            id="cfg-text"
            className={inputClass}
            rows={4}
            maxLength={4096}
            disabled={readOnly}
            value={str(config.text)}
            onChange={(e) => set({ text: e.target.value })}
          />
          <p className="mt-1 text-xs text-muted">{t("flows.sendTextHint")}</p>
        </div>
      ) : null}

      {type === "condition" ? (
        <>
          <div>
            <label className={labelClass} htmlFor="cfg-predicate">
              {t("flows.conditionPredicateLabel")}
            </label>
            <select
              id="cfg-predicate"
              className={inputClass}
              disabled={readOnly}
              value={str(config.predicate) || "has_tag"}
              onChange={(e) => {
                const predicate = e.target.value;
                if (predicate === "has_tag")
                  onChange(node.id, { predicate, tag: str(config.tag) });
                else if (predicate === "stage_equals")
                  onChange(node.id, {
                    predicate,
                    stage: str(config.stage) || stageOptions[0]!,
                  });
                else if (predicate === "field_equals")
                  onChange(node.id, {
                    predicate,
                    field: str(config.field) || "name",
                    value: str(config.value),
                  });
                else
                  onChange(node.id, {
                    predicate,
                    text: str(config.text),
                  });
              }}
            >
              <option value="has_tag">{t("flows.predicateHasTag")}</option>
              <option value="stage_equals">
                {t("flows.predicateStageEquals")}
              </option>
              <option value="field_equals">
                {t("flows.predicateFieldEquals")}
              </option>
              <option value="message_contains">
                {t("flows.predicateMessageContains")}
              </option>
            </select>
          </div>
          {config.predicate === "stage_equals" ? (
            <div>
              <label className={labelClass} htmlFor="cfg-cond-stage">
                {t("flows.conditionStageLabel")}
              </label>
              <select
                id="cfg-cond-stage"
                className={inputClass}
                disabled={readOnly}
                value={str(config.stage)}
                onChange={(e) => set({ stage: e.target.value })}
              >
                {stageOptions.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(t, s)}
                  </option>
                ))}
              </select>
            </div>
          ) : config.predicate === "field_equals" ? (
            <>
              <div>
                <label className={labelClass} htmlFor="cfg-cond-field">
                  {t("flows.conditionFieldLabel")}
                </label>
                <select
                  id="cfg-cond-field"
                  className={inputClass}
                  disabled={readOnly}
                  value={str(config.field) || "name"}
                  onChange={(e) => set({ field: e.target.value })}
                >
                  <option value="name">{t("flows.fieldName")}</option>
                  <option value="phone">{t("flows.fieldPhone")}</option>
                  <option value="email">{t("flows.fieldEmail")}</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="cfg-cond-value">
                  {t("flows.conditionValueLabel")}
                </label>
                <input
                  id="cfg-cond-value"
                  className={inputClass}
                  disabled={readOnly}
                  value={str(config.value)}
                  onChange={(e) => set({ value: e.target.value })}
                />
              </div>
            </>
          ) : config.predicate === "message_contains" ? (
            <div>
              <label className={labelClass} htmlFor="cfg-cond-text">
                {t("flows.conditionTextLabel")}
              </label>
              <input
                id="cfg-cond-text"
                className={inputClass}
                disabled={readOnly}
                value={str(config.text)}
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          ) : (
            <div>
              <label className={labelClass} htmlFor="cfg-cond-tag">
                {t("flows.conditionTagLabel")}
              </label>
              <input
                id="cfg-cond-tag"
                className={inputClass}
                disabled={readOnly}
                list="flow-tag-options"
                value={str(config.tag)}
                onChange={(e) => set({ tag: e.target.value })}
              />
            </div>
          )}
        </>
      ) : null}

      {type === "delay" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="cfg-delay-amount">
              {t("flows.delayAmountLabel")}
            </label>
            <input
              id="cfg-delay-amount"
              type="number"
              min={0}
              step={1}
              className={inputClass}
              disabled={readOnly}
              value={
                typeof config.amount === "number" ? config.amount : 0
              }
              onChange={(e) =>
                set({ amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="cfg-delay-unit">
              {t("flows.delayUnitLabel")}
            </label>
            <select
              id="cfg-delay-unit"
              className={inputClass}
              disabled={readOnly}
              value={str(config.unit) || "minutes"}
              onChange={(e) => set({ unit: e.target.value })}
            >
              <option value="seconds">{t("flows.unitSeconds")}</option>
              <option value="minutes">{t("flows.unitMinutes")}</option>
              <option value="hours">{t("flows.unitHours")}</option>
            </select>
          </div>
        </div>
      ) : null}

      {type === "add_tag" || type === "remove_tag" ? (
        <div>
          <label className={labelClass} htmlFor="cfg-tag">
            {t("flows.tagLabel")}
          </label>
          <input
            id="cfg-tag"
            className={inputClass}
            disabled={readOnly}
            list="flow-tag-options"
            placeholder={t("flows.tagPlaceholder")}
            value={str(config.tag)}
            onChange={(e) => set({ tag: e.target.value })}
          />
        </div>
      ) : null}

      {type === "set_stage" ? (
        <div>
          <label className={labelClass} htmlFor="cfg-stage">
            {t("flows.stageLabel")}
          </label>
          <select
            id="cfg-stage"
            className={inputClass}
            disabled={readOnly}
            value={str(config.stage)}
            onChange={(e) => set({ stage: e.target.value })}
          >
            {[...new Set([...stageOptions, str(config.stage)].filter(Boolean))].map(
              (s) => (
                <option key={s} value={s}>
                  {stageLabel(t, s)}
                </option>
              ),
            )}
          </select>
        </div>
      ) : null}

      {type === "enroll_sequence" ? (
        <div>
          <label className={labelClass} htmlFor="cfg-sequence">
            {t("flows.sequenceLabel")}
          </label>
          {meta.sequences.length === 0 ? (
            <p className="text-sm text-muted">{t("flows.sequenceNone")}</p>
          ) : (
            <select
              id="cfg-sequence"
              className={inputClass}
              disabled={readOnly}
              value={str(config.automationId)}
              onChange={(e) => set({ automationId: e.target.value })}
            >
              <option value="">{t("flows.sequencePlaceholder")}</option>
              {meta.sequences.map((seq) => (
                <option key={seq.id} value={seq.id}>
                  {seq.name}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : null}

      {type === "ai_response" ? (
        <p className="text-sm text-muted">{t("flows.staticAiResponse")}</p>
      ) : null}
      {type === "handoff" ? (
        <p className="text-sm text-muted">{t("flows.staticHandoff")}</p>
      ) : null}
      {type === "end" ? (
        <p className="text-sm text-muted">{t("flows.staticEnd")}</p>
      ) : null}

      <datalist id="flow-tag-options">
        {meta.tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}

// ---------------------------------------------------------------------------

const RUN_STATUS_CHIP: Record<FlowRunResponse["status"], string> = {
  running: "bg-warning/15 text-warning",
  waiting: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-elevated text-muted",
};

const RUN_STATUS_LABEL_KEYS: Record<FlowRunResponse["status"], TranslationKey> = {
  running: "flows.runStatusRunning",
  waiting: "flows.runStatusWaiting",
  completed: "flows.runStatusCompleted",
  failed: "flows.runStatusFailed",
  cancelled: "flows.runStatusCancelled",
};

const STEP_OUTCOME_LABEL_KEYS: Record<string, TranslationKey> = {
  passed: "flows.stepOutcomePassed",
  queued: "flows.stepOutcomeQueued",
  evaluated: "flows.stepOutcomeEvaluated",
  waiting: "flows.stepOutcomeWaiting",
  tag_added: "flows.stepOutcomeTagAdded",
  tag_removed: "flows.stepOutcomeTagRemoved",
  stage_set: "flows.stepOutcomeStageSet",
  skipped: "flows.stepOutcomeSkipped",
  enrolled: "flows.stepOutcomeEnrolled",
  handed_off: "flows.stepOutcomeHandedOff",
  ended: "flows.stepOutcomeEnded",
  responded: "flows.stepOutcomeResponded",
  failed: "flows.stepOutcomeFailed",
  cap_exceeded: "flows.stepOutcomeCapExceeded",
};

interface FlowRunsPanelProps {
  t: Translate;
  locale: Locale;
  tenantId: string;
  flowId: string;
  graph: FlowGraph;
}

/**
 * Penampil run flow (permukaan debugging 8A): daftar run + timeline
 * langkah run terpilih, dari endpoint runs/steps yang sama yang
 * dipakai rantai uji. Polling 5 dtk selama panel terbuka dan ada run
 * non-terminal (pola usePolling dashboard).
 */
function FlowRunsPanel({ t, locale, tenantId, flowId, graph }: FlowRunsPanelProps) {
  const [runs, setRuns] = useState<FlowRunResponse[]>([]);
  const [runsCursor, setRunsCursor] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<FlowRunStepResponse[]>([]);
  const [stepsCursor, setStepsCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nodeLabel = useCallback(
    (nodeId: string): string => {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) return nodeId;
      const key = FLOW_NODE_LABEL_KEYS[node.type];
      return key ? t(key) : node.type;
    },
    [graph, t],
  );

  const loadRuns = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const page = await api.flows.listRuns(tenantId, flowId, { limit: 50 });
        setRuns(page.runs);
        setRunsCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        if (!silent) setError(translateApiError(t, err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [tenantId, flowId, t],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const anyLive = runs.some(
    (r) => r.status === "running" || r.status === "waiting",
  );
  usePolling(() => void loadRuns(true), 5000, anyLive);

  const loadSteps = useCallback(
    async (runId: string) => {
      try {
        const page = await api.flows.listRunSteps(tenantId, runId, {
          limit: 200,
        });
        setSteps(page.steps);
        setStepsCursor(page.nextCursor);
      } catch (err) {
        setError(translateApiError(t, err));
        setSteps([]);
      }
    },
    [tenantId, t],
  );

  useEffect(() => {
    if (selectedRunId) void loadSteps(selectedRunId);
    else setSteps([]);
  }, [selectedRunId, loadSteps]);

  usePolling(
    () => {
      if (selectedRunId) void loadSteps(selectedRunId);
    },
    5000,
    Boolean(selectedRunId) && anyLive,
  );

  const loadMoreRuns = async () => {
    if (!runsCursor) return;
    try {
      const page = await api.flows.listRuns(tenantId, flowId, {
        limit: 50,
        cursor: runsCursor,
      });
      setRuns((prev) => [...prev, ...page.runs]);
      setRunsCursor(page.nextCursor);
    } catch (err) {
      setError(translateApiError(t, err));
    }
  };

  const loadMoreSteps = async () => {
    if (!stepsCursor || !selectedRunId) return;
    try {
      const page = await api.flows.listRunSteps(tenantId, selectedRunId, {
        limit: 200,
        cursor: stepsCursor,
      });
      setSteps((prev) => [...prev, ...page.steps]);
      setStepsCursor(page.nextCursor);
    } catch (err) {
      setError(translateApiError(t, err));
    }
  };

  const stepDetailLine = (step: FlowRunStepResponse): string => {
    const d = step.detail ?? {};
    const outcome = typeof d.outcome === "string" ? d.outcome : "";
    const parts: string[] = [];
    const outcomeKey = STEP_OUTCOME_LABEL_KEYS[outcome];
    if (outcomeKey) parts.push(t(outcomeKey));
    else if (outcome) parts.push(outcome);
    if (outcome === "evaluated") {
      parts.push(
        d.result === true ? t("flows.stepResultYes") : t("flows.stepResultNo"),
      );
    }
    if (typeof d.tag === "string" && d.tag) parts.push(d.tag);
    if (typeof d.stage === "string" && d.stage)
      parts.push(stageLabel(t, d.stage));
    if (outcome === "skipped" && typeof d.reason === "string" && d.reason) {
      parts.push(t("flows.stepReason", { reason: d.reason }));
    }
    if (typeof d.delayMs === "number") {
      parts.push(`${Math.round(d.delayMs / 100) / 10}s`);
    }
    return parts.join(" · ");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {t("flows.runsTitle")}
          </h3>
          <button
            type="button"
            onClick={() => void loadRuns()}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-elevated"
          >
            {t("flows.runsRefresh")}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">{t("flows.runsHint")}</p>
        {error ? (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {loading ? (
          <p className="mt-4 text-sm text-muted">{t("workspace.loading")}</p>
        ) : runs.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("flows.runsEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left ${
                    selectedRunId === run.id
                      ? "border-accent bg-surface"
                      : "border-line bg-surface hover:bg-elevated"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {run.contactName}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS_CHIP[run.status]}`}
                    >
                      {t(RUN_STATUS_LABEL_KEYS[run.status])}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {formatDateTime(run.startedAt, locale)}
                    {" · "}
                    {t("flows.runStepsCount", { count: run.stepCount })}
                    {run.errorCode
                      ? ` · ${t("flows.runErrorLabel")}: ${run.errorCode}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {runsCursor ? (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => void loadMoreRuns()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
            >
              {t("flows.loadMore")}
            </button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">
          {t("flows.stepsTitle")}
        </h3>
        {!selectedRunId ? (
          <p className="mt-3 text-sm text-muted">{t("flows.stepsEmpty")}</p>
        ) : steps.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("workspace.loading")}</p>
        ) : (
          <ol className="mt-3 space-y-0">
            {steps.map((step, idx) => (
              <li key={step.id} className="relative flex gap-3 pb-4">
                {idx < steps.length - 1 ? (
                  <span className="absolute left-[11px] top-6 h-[calc(100%-16px)] w-px bg-line" />
                ) : null}
                <span
                  className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    step.error
                      ? "bg-danger/15 text-danger"
                      : "bg-elevated text-muted"
                  }`}
                >
                  {step.seq}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {nodeLabel(step.nodeId)}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {formatDateTime(step.createdAt, locale)}
                    </span>
                  </p>
                  <p className="text-xs text-muted">{stepDetailLine(step)}</p>
                  {step.error ? (
                    <p className="text-xs text-danger">{step.error}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
        {selectedRunId && stepsCursor ? (
          <div className="mt-1 text-center">
            <button
              type="button"
              onClick={() => void loadMoreSteps()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated"
            >
              {t("flows.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface BuilderInnerProps {
  t: Translate;
  locale: Locale;
  tenantId: string;
  flow: FlowResponse;
  canManage: boolean;
  meta: TenantMeta;
  onFlowChange: (flow: FlowResponse) => void;
  onBack: () => void;
}

function BuilderInner({
  t,
  locale,
  tenantId,
  flow,
  canManage,
  meta,
  onFlowChange,
  onBack,
}: BuilderInnerProps) {
  const readOnly = flow.status !== "draft" || !canManage;
  const [name, setName] = useState(flow.name);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowRfNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowRfEdge>([]);
  const [tab, setTab] = useState<"canvas" | "runs">("canvas");
  const [issues, setIssues] = useState<FlowGraphIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const snapshotRef = useRef<string>("");
  const counterRef = useRef(0);
  const reactFlow = useReactFlow();
  const initializedForRef = useRef<string | null>(null);

  // Muat graf ke kanvas sekali per flow (atau saat status kembali ke
  // draft lewat nonaktifkan — graf server adalah sumber kebenaran).
  useEffect(() => {
    if (initializedForRef.current === flow.id) return;
    initializedForRef.current = flow.id;
    const { nodes: rfNodes, edges: rfEdges } = graphToRf(flow.graph);
    const labeledEdges = rfEdges.map((e) =>
      e.data?.branch
        ? {
            ...e,
            label: t(e.data.branch === "yes" ? "flows.branchYes" : "flows.branchNo"),
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 6,
            labelBgStyle: { fill: "rgb(var(--color-surface))" },
            labelStyle: {
              fill: "rgb(var(--color-text-muted))",
              fontSize: 11,
              fontWeight: 600,
            },
          }
        : e,
    );
    setNodes(rfNodes);
    setEdges(labeledEdges);
    setName(flow.name);
    snapshotRef.current = JSON.stringify({
      name: flow.name,
      graph: rfToGraph(rfNodes, rfEdges),
    });
    setIssues([]);
    setNotice(null);
    setError(null);
  }, [flow, setNodes, setEdges]);

  const currentGraph = useMemo(
    () => rfToGraph(nodes, edges),
    [nodes, edges],
  );
  const dirty =
    snapshotRef.current !== "" &&
    JSON.stringify({ name, graph: currentGraph }) !== snapshotRef.current;

  const selectedNode = nodes.find((n) => n.selected) ?? null;

  const sequenceName = useCallback(
    (automationId: string) =>
      meta.sequences.find((s) => s.id === automationId)?.name,
    [meta.sequences],
  );

  // Tandai node yang disebut issue (klik issue juga memilih node itu).
  useEffect(() => {
    const severityByNode = new Map<string, "error" | "warning">();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      const prev = severityByNode.get(issue.nodeId);
      if (prev !== "error") severityByNode.set(issue.nodeId, issue.severity);
    }
    setNodes((prev) =>
      prev.map((n) => {
        const sev = severityByNode.get(n.id) ?? null;
        return n.data.issueSeverity === sev
          ? n
          : { ...n, data: { ...n.data, issueSeverity: sev } };
      }),
    );
  }, [issues, setNodes]);

  const focusNode = useCallback(
    (nodeId: string) => {
      setTab("canvas");
      setNodes((prev) =>
        prev.map((n) => ({ ...n, selected: n.id === nodeId })),
      );
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        void reactFlow.setCenter(
          node.position.x + 114,
          node.position.y + 40,
          { zoom: 1.1, duration: 400 },
        );
      }
    },
    [nodes, reactFlow, setNodes],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      // Trigger tidak pernah terhapus (deletable=false + saring di sini
      // untuk jalur keyboard sekalipun).
      const safeChanges = changes.filter(
        (c) =>
          !(
            c.type === "remove" &&
            nodes.find((n) => n.id === c.id)?.data.nodeType === "trigger"
          ),
      );
      const removedIds = safeChanges
        .filter((c) => c.type === "remove")
        .map((c) => c.id);
      onNodesChange(safeChanges);
      if (removedIds.length > 0) {
        setEdges((prev) =>
          prev.filter(
            (e) => !removedIds.includes(e.source) && !removedIds.includes(e.target),
          ),
        );
      }
    },
    [nodes, onNodesChange, setEdges],
  );

  // Mode hanya-baca: perubahan posisi/koneksi dimatikan, tetapi seleksi
  // tetap diteruskan agar panel konfigurasi bisa dipakai untuk MEMBACA.
  const handleNodesChangeReadOnly = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes.filter((c) => c.type === "select"));
    },
    [onNodesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;
      if (targetNode.data.nodeType === "trigger") return;
      const branch =
        sourceNode.data.nodeType === "condition"
          ? connection.sourceHandle === "no"
            ? ("no" as const)
            : ("yes" as const)
          : undefined;
      counterRef.current += 1;
      const newEdge: FlowRfEdge = {
        id: `e-${connection.source}-${branch ?? "next"}-${connection.target}-${Date.now()}-${counterRef.current}`,
        source: connection.source,
        target: connection.target,
        ...(branch ? { sourceHandle: branch } : {}),
        ...(branch
          ? {
              label: t(branch === "yes" ? "flows.branchYes" : "flows.branchNo"),
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 6,
              labelBgStyle: { fill: "rgb(var(--color-surface))" },
              labelStyle: {
                fill: "rgb(var(--color-text-muted))",
                fontSize: 11,
                fontWeight: 600,
              },
            }
          : {}),
        data: branch ? { branch } : {},
      };
      setEdges((prev) => {
        // Satu edge keluar per (node, cabang): koneksi baru menggantikan
        // yang lama — selaras semantik eksekutor (edge pertama yang
        // dipakai untuk node non-condition).
        const kept = prev.filter(
          (e) =>
            !(
              e.source === connection.source &&
              (e.data?.branch ?? undefined) === branch
            ),
        );
        return addEdge(newEdge, kept);
      });
    },
    [nodes, setEdges, t],
  );

  const isValidConnection = useCallback(
    (connection: Connection | FlowRfEdge) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!targetNode || targetNode.data.nodeType === "trigger") return false;
      return true;
    },
    [nodes],
  );

  const addNode = useCallback(
    (type: FlowNodeType, position?: { x: number; y: number }) => {
      counterRef.current += 1;
      const id = `n_${type}_${Date.now().toString(36)}_${counterRef.current}`;
      const maxY = nodes.reduce((acc, n) => Math.max(acc, n.position.y), 0);
      const newNode: FlowRfNode = {
        id,
        type: "flowNode",
        position: position ?? { x: 290, y: maxY + 180 },
        data: {
          nodeType: type,
          config: defaultNodeConfig(type),
          issueSeverity: null,
        },
        deletable: type !== "trigger",
        selected: true,
      };
      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        newNode,
      ]);
    },
    [nodes, setNodes],
  );

  const onDragStartPalette = (
    event: React.DragEvent,
    type: FlowNodeType,
  ) => {
    event.dataTransfer.setData("application/sk-flow-node", type);
    event.dataTransfer.effectAllowed = "move";
  };

  const onCanvasDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(
        "application/sk-flow-node",
      ) as FlowNodeType;
      if (!type || !ADDABLE_NODE_TYPES.includes(type)) return;
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(type, { x: position.x - 114, y: position.y - 30 });
    },
    [addNode, reactFlow],
  );

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, config } } : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
    },
    [setNodes, setEdges],
  );

  const saveDraft = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.flows.update(tenantId, flow.id, {
        name: name.trim() || flow.name,
        graph: currentGraph,
      });
      snapshotRef.current = JSON.stringify({
        name: saved.name,
        graph: rfToGraph(nodes, edges),
      });
      onFlowChange(saved);
      return true;
    } catch (err) {
      setError(translateApiError(t, err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [tenantId, flow.id, flow.name, name, currentGraph, nodes, edges, onFlowChange, t]);

  const runValidate = async () => {
    setValidating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.flows.validate(tenantId, flow.id, currentGraph);
      setIssues(result.issues);
      const { errors, warnings } = splitIssues(result.issues);
      if (errors.length === 0) {
        setNotice(
          warnings.length > 0
            ? t("flows.validWithWarnings", { count: warnings.length })
            : t("flows.validOk"),
        );
      }
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setValidating(false);
    }
  };

  const runActivate = async () => {
    setActivating(true);
    setError(null);
    setNotice(null);
    try {
      if (dirty) {
        const ok = await saveDraft();
        if (!ok) return;
      }
      const result = await api.flows.activate(tenantId, flow.id);
      onFlowChange(result.flow);
      setIssues(result.warnings);
      setNotice(
        result.warnings.length > 0
          ? t("flows.activatedWithWarnings", {
              count: result.warnings.length,
            })
          : t("flows.activatedOk"),
      );
    } catch (err) {
      const parsed = issuesFromError(err);
      if (err instanceof ApiClientError && err.code === "FLOW_GRAPH_INVALID" && parsed) {
        setIssues(parsed);
      } else {
        setError(translateApiError(t, err));
      }
    } finally {
      setActivating(false);
    }
  };

  const changeStatus = async (action: "deactivate" | "unarchive") => {
    setStatusBusy(true);
    setError(null);
    try {
      const updated =
        action === "deactivate"
          ? await api.flows.deactivate(tenantId, flow.id)
          : await api.flows.unarchive(tenantId, flow.id);
      // Status kembali draft → muat ulang graf dari server ke kanvas.
      initializedForRef.current = null;
      onFlowChange(updated);
    } catch (err) {
      setError(translateApiError(t, err));
    } finally {
      setStatusBusy(false);
    }
  };

  const { errors: issueErrors, warnings: issueWarnings } = splitIssues(issues);

  const renderIssueList = (list: FlowGraphIssue[], danger: boolean) => (
    <ul className="space-y-1">
      {list.map((issue, i) => {
        const node = issue.nodeId
          ? nodes.find((n) => n.id === issue.nodeId)
          : undefined;
        return (
          <li key={`${issue.code}-${issue.nodeId ?? "graph"}-${i}`}>
            <button
              type="button"
              disabled={!node}
              onClick={() => issue.nodeId && focusNode(issue.nodeId)}
              className={`text-left text-sm ${
                danger ? "text-danger" : "text-warning"
              } ${node ? "hover:underline" : "cursor-default"}`}
            >
              {translateFlowIssue(t, issue)}
              <span className="text-muted">
                {" — "}
                {node
                  ? t("flows.issueOnNode", {
                      node: t(FLOW_NODE_LABEL_KEYS[node.data.nodeType]),
                    })
                  : t("flows.issueGraphWide")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const shared: BuilderShared = { t, readOnly, sequenceName };

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted hover:text-ink"
      >
        ← {t("flows.backToList")}
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          className="min-w-52 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-lg font-bold text-ink disabled:opacity-70 sm:flex-none sm:text-xl"
          value={name}
          disabled={readOnly}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          aria-label={t("flows.nameLabel")}
        />
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            flow.status === "active"
              ? "bg-success/15 text-success"
              : "bg-elevated text-muted"
          }`}
        >
          {t(
            flow.status === "active"
              ? "flows.statusActive"
              : flow.status === "archived"
                ? "flows.statusArchived"
                : "flows.statusDraft",
          )}
        </span>
        <span className="text-xs text-muted">
          {t("flows.runCount", { count: flow.runCount })}
        </span>
      </div>

      {flow.status !== "draft" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-ink">
          <span>
            {flow.status === "active"
              ? t("flows.readonlyActive")
              : t("flows.readonlyArchived")}
          </span>
          {canManage ? (
            <button
              type="button"
              disabled={statusBusy}
              onClick={() =>
                void changeStatus(
                  flow.status === "active" ? "deactivate" : "unarchive",
                )
              }
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-elevated disabled:opacity-50"
            >
              {flow.status === "active"
                ? t("flows.deactivateToEdit")
                : t("flows.unarchiveToEdit")}
            </button>
          ) : null}
        </div>
      ) : null}
      {!canManage ? (
        <p className="mt-4 rounded-lg bg-elevated px-3 py-2 text-sm text-muted">
          {t("flows.forbidden")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(
            [
              ["canvas", "flows.tabCanvas"],
              ["runs", "flows.tabRuns"],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`px-3 py-1.5 text-sm font-medium ${
                tab === value
                  ? "bg-accent text-white"
                  : "bg-surface text-muted hover:text-ink"
              }`}
            >
              {t(key)}
            </button>
          ))}
        </div>
        {tab === "canvas" && !readOnly ? (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void saveDraft().then((ok) => {
                  if (ok) setNotice(t("flows.savedOk"));
                })
              }
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t("flows.saving") : t("flows.saveDraft")}
            </button>
            <button
              type="button"
              disabled={validating}
              onClick={() => void runValidate()}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-elevated disabled:opacity-50"
            >
              {t("flows.validateButton")}
            </button>
            <button
              type="button"
              disabled={activating}
              onClick={() => void runActivate()}
              className="rounded-lg border border-success px-3 py-1.5 text-sm font-medium text-success hover:bg-success/10 disabled:opacity-50"
            >
              {activating ? t("flows.activating") : t("flows.activateButton")}
            </button>
            {dirty ? (
              <span className="text-xs text-warning">
                {t("flows.unsavedChanges")}
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          {notice}
        </p>
      ) : null}
      {issueErrors.length > 0 ? (
        <div className="mt-3 rounded-lg bg-danger/5 px-3 py-2">
          <p className="text-sm font-semibold text-danger">
            {t("flows.issuesErrorsTitle")}
          </p>
          <div className="mt-1">{renderIssueList(issueErrors, true)}</div>
        </div>
      ) : null}
      {issueWarnings.length > 0 ? (
        <div className="mt-3 rounded-lg bg-warning/5 px-3 py-2">
          <p className="text-sm font-semibold text-warning">
            {t("flows.issuesWarningsTitle")}
          </p>
          <div className="mt-1">{renderIssueList(issueWarnings, false)}</div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <FlowRunsPanel
            t={t}
            locale={locale}
            tenantId={tenantId}
            flowId={flow.id}
            graph={currentGraph}
          />
        </div>
      ) : (
        <div
          className={`mt-4 grid gap-4 ${
            readOnly
              ? "xl:grid-cols-[minmax(0,1fr)_300px]"
              : "xl:grid-cols-[220px_minmax(0,1fr)_300px]"
          }`}
        >
          {!readOnly ? (
            <aside className="order-2 rounded-xl border border-line bg-surface p-3 xl:order-1">
              <h3 className="text-sm font-semibold text-ink">
                {t("flows.paletteTitle")}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {t("flows.paletteHint")}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
                {ADDABLE_NODE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={(e) => onDragStartPalette(e, type)}
                    onClick={() => addNode(type)}
                    className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-xs font-medium text-ink hover:bg-elevated"
                  >
                    <svg
                      className="h-4 w-4 shrink-0 text-muted"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.7}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden={true}
                    >
                      <path d={NODE_ICON_PATHS[type]} />
                    </svg>
                    {t(FLOW_NODE_LABEL_KEYS[type])}
                  </button>
                ))}
              </div>
            </aside>
          ) : null}

          <div
            className="sk-flow order-1 h-[560px] overflow-hidden rounded-xl border border-line xl:order-2"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={readOnly ? undefined : onCanvasDrop}
          >
            <BuilderCtx.Provider value={shared}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodesChange={
                  readOnly ? handleNodesChangeReadOnly : handleNodesChange
                }
                onEdgesChange={readOnly ? undefined : onEdgesChange}
                onConnect={readOnly ? undefined : handleConnect}
                isValidConnection={isValidConnection}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable
                deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
                fitView
                fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={1.75}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.6}
                />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable />
              </ReactFlow>
            </BuilderCtx.Provider>
          </div>

          <aside className="order-3 rounded-xl border border-line bg-surface p-4">
            <h3 className="text-sm font-semibold text-ink">
              {t("flows.configTitle")}
            </h3>
            <div className="mt-3">
              {selectedNode ? (
                <NodeConfigPanel
                  t={t}
                  node={selectedNode}
                  meta={meta}
                  readOnly={readOnly}
                  onChange={updateNodeConfig}
                  onDelete={deleteNode}
                />
              ) : (
                <p className="text-sm text-muted">{t("flows.configEmpty")}</p>
              )}
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              {t("flows.canvasHint")}
            </p>
          </aside>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface FlowBuilderPageProps {
  t: Translate;
  locale: Locale;
  flowId: string;
  onBack: () => void;
}

/**
 * Halaman Flow Builder (Fase 8B) di /flows/:flowId: memuat flow +
 * metadata tenant (tag/stage dari kontak, sequence aktif), lalu
 * menyerahkan kanvas ke BuilderInner di dalam ReactFlowProvider.
 */
export function FlowBuilderPage({
  t,
  locale,
  flowId,
  onBack,
}: FlowBuilderPageProps) {
  const { status, active } = useWorkspace();
  const tenantId = active?.id ?? null;
  const canManage = active?.role === "owner" || active?.role === "admin";
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [meta, setMeta] = useState<TenantMeta>({
    tags: [],
    stages: [],
    sequences: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [flowRes, automations, contacts] = await Promise.all([
          api.flows.get(tenantId, flowId),
          api.automations.list(tenantId).catch(() => []),
          api.contacts.list(tenantId, { limit: 200 }).catch(() => null),
        ]);
        if (cancelled) return;
        setFlow(flowRes);
        const tags = new Set<string>();
        const stages = new Set<string>();
        for (const contact of contacts?.contacts ?? []) {
          for (const tag of contact.tags) tags.add(tag);
          if (contact.pipelineStage) stages.add(contact.pipelineStage);
        }
        setMeta({
          tags: [...tags].sort(),
          stages: [...stages].sort(),
          sequences: automations.filter(
            (a) => a.kind === "sequence" && a.isActive,
          ),
        });
      } catch (err) {
        if (!cancelled) setError(translateApiError(t, err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, flowId, t]);

  if (status === "loading" || loading) {
    return (
      <section>
        <p className="mt-6 text-sm text-muted">{t("workspace.loading")}</p>
      </section>
    );
  }
  if (status === "error" || error || !flow || !tenantId) {
    return (
      <section>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted hover:text-ink"
        >
          ← {t("flows.backToList")}
        </button>
        <p className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? t("errors.NOT_FOUND")}
        </p>
      </section>
    );
  }

  return (
    <ReactFlowProvider>
      <BuilderInner
        t={t}
        locale={locale}
        tenantId={tenantId}
        flow={flow}
        canManage={canManage}
        meta={meta}
        onFlowChange={setFlow}
        onBack={onBack}
      />
    </ReactFlowProvider>
  );
}
