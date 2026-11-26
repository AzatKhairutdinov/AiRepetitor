import { teamListFlows } from "@airepetitor/contract/client";
import { FLOWS, type FlowGraph, type Owner, flowGraph } from "@airepetitor/flows";
import { type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { FlowSummary } from "../../../../libs/contract/src/client/api.schemas.ts";

const OWNERS: Record<Owner, { label: string; color: string }> = {
  tutor: { label: "Репетитор", color: "#cfe3ff" },
  methodologist: { label: "Методист", color: "#ffd9e6" },
  worker: { label: "worker", color: "#ffe8c2" },
  code: { label: "код", color: "#d8f3dc" },
  system: { label: "система", color: "#e9e9ef" },
  learner: { label: "Ученик", color: "#fff3b0" },
};

const NODE_W = 200;
const NODE_H = 56;
const elk = new ELK();

/** Lays the graph out top to bottom with ELK and converts it to React Flow nodes and edges. */
async function layout(graph: FlowGraph): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const laid = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  });
  const position = new Map((laid.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      position: position.get(n.id) ?? { x: 0, y: 0 },
      data: { label: `${n.initial ? "▶ " : ""}${n.title}` },
      style: {
        width: NODE_W,
        background: OWNERS[n.owner].color,
        border: n.final ? "3px double #333" : "1px solid #555",
        borderRadius: 8,
      },
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: [e.event ?? "автоматически", e.condition].filter(Boolean).join(": "),
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  };
}

function Diagram({ flow }: { flow: FlowSummary }) {
  const [laid, setLaid] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const entry = FLOWS.find((f) => f.machine.id === flow.id);

  useEffect(() => {
    if (entry) void layout(flowGraph(entry.machine)).then(setLaid);
  }, [entry]);

  if (!entry) return <p>Схемы «{flow.title}» нет в этой сборке сайта.</p>;
  return (
    <section>
      <h2>
        {flow.title} <small>v{flow.version}</small>
      </h2>
      <div style={{ height: 420, border: "1px solid #ddd" }}>
        {laid && <ReactFlow nodes={laid.nodes} edges={laid.edges} fitView nodesDraggable={false} />}
      </div>
    </section>
  );
}

/** Team page: a diagram per Processing scenario, coloured by who carries out each step. */
export function TeamFlows() {
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    teamListFlows()
      .then((res) => (res.status === 200 ? setFlows(res.data.items) : setDenied(true)))
      .catch(() => setDenied(true));
  }, []);

  if (denied)
    return (
      <main>
        Страница только для команды. <Link to="/">На главную</Link>
      </main>
    );
  if (!flows) return <main>Загрузка…</main>;

  return (
    <main>
      <h1>Схемы процессов</h1>
      <p>
        {Object.values(OWNERS).map((o) => (
          <span
            key={o.label}
            style={{ background: o.color, padding: "2px 8px", marginRight: 8, borderRadius: 4 }}
          >
            {o.label}
          </span>
        ))}
      </p>
      {flows.map((f) => (
        <Diagram key={f.id} flow={f} />
      ))}
    </main>
  );
}
