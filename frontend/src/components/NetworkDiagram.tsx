import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { NetworkGraph, ScheduledActivity } from '../types/cpm';
import {
  DownloadIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ResetIcon,
} from './Icons';
import './NetworkDiagram.css';

interface NetworkDiagramProps {
  graph: NetworkGraph;
  timed: boolean;
  activities?: ScheduledActivity[];
  activeCriticalPath?: string[] | null;
  highlightedStepElements?: {
    nodes?: number[];
    edges?: string[];
    type?: 'forward' | 'backward' | 'critical' | 'all';
  } | null;
}

export const NetworkDiagram: React.FC<NetworkDiagramProps> = ({
  graph,
  timed,
  activities = [],
  activeCriticalPath = null,
  highlightedStepElements = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());

  // Pan & Zoom state
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPoint, setStartPoint] = useState({ x: 0, y: 0 });

  // Tooltip & Selection state
  const [hoveredNode, setHoveredNode] = useState<any | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Map activities by name for rapid tooltip lookup
  const actMap = useMemo(() => {
    const map = new Map<string, ScheduledActivity>();
    for (const a of activities) {
      map.set(String(a.name), a);
    }
    return map;
  }, [activities]);

  const activeEdgeName = hoveredEdge?.name || selectedEdge;
  const selectedEdgeData = useMemo(() => {
    if (!selectedEdge) return null;
    return graph.edges.find((e) => e.name === selectedEdge) || null;
  }, [graph.edges, selectedEdge]);

  const isFocusMode = Boolean(
    activeEdgeName ||
      hoveredNode ||
      activeCriticalPath ||
      (highlightedStepElements &&
        (highlightedStepElements.nodes ||
          highlightedStepElements.edges ||
          highlightedStepElements.type))
  );

  const sortedEdges = useMemo(() => {
    return [...graph.edges].sort((a, b) => {
      const aCrit = timed && a.critical ? 1 : 0;
      const bCrit = timed && b.critical ? 1 : 0;
      const aActive =
        activeCriticalPath?.includes(a.name) || activeEdgeName === a.name ? 2 : 0;
      const bActive =
        activeCriticalPath?.includes(b.name) || activeEdgeName === b.name ? 2 : 0;
      return aCrit + aActive - (bCrit + bActive);
    });
  }, [graph.edges, timed, activeCriticalPath, activeEdgeName]);

  // Fit diagram to container
  const resetView = useCallback(() => {
    if (!containerRef.current || !graph.width || !graph.height) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;
    const padding = 48;
    const scaleX = (clientWidth - padding) / graph.width;
    const scaleY = (clientHeight - padding) / graph.height;
    const fitScale = Math.min(1.25, Math.max(0.04, Math.min(scaleX, scaleY)));
    setScale(fitScale);
    setPan({
      x: (clientWidth - graph.width * fitScale) / 2,
      y: (clientHeight - graph.height * fitScale) / 2,
    });
  }, [graph.width, graph.height]);

  useEffect(() => {
    resetView();
  }, [resetView]);

  // Measure path lengths dynamically for accurate drawing animations
  useEffect(() => {
    pathRefs.current.forEach((pathEl) => {
      if (pathEl) {
        try {
          const length = pathEl.getTotalLength();
          pathEl.style.setProperty('--path-length', `${Math.ceil(length)}px`);
        } catch {
          // ignore measurement errors if element is detached
        }
      }
    });
  }, [graph]);

  // Zoom controls
  const handleZoom = (delta: number) => {
    setScale((prev) => Math.min(4, Math.max(0.04, prev + delta)));
  };

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setStartPoint({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - startPoint.x,
      y: e.clientY - startPoint.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  // Non-passive wheel zoom & touch handlers
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      setScale((prev) => Math.min(4, Math.max(0.04, prev * zoomFactor)));
    };

    let initialDist = 0;
    let initialScale = 1;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchPanning = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isTouchPanning = true;
        touchStartX = e.touches[0].clientX - pan.x;
        touchStartY = e.touches[0].clientY - pan.y;
      } else if (e.touches.length === 2) {
        isTouchPanning = false;
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = scale;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isTouchPanning) {
        setPan({
          x: e.touches[0].clientX - touchStartX,
          y: e.touches[0].clientY - touchStartY,
        });
      } else if (e.touches.length === 2 && initialDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / initialDist;
        setScale(Math.min(4, Math.max(0.04, initialScale * factor)));
      }
    };

    const onTouchEnd = () => {
      isTouchPanning = false;
      initialDist = 0;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [pan.x, pan.y, scale]);

  // Export SVG
  const downloadSVG = () => {
    const blob = new Blob([graph.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpm_aoa_network_${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export PNG
  const downloadPNG = () => {
    const img = new Image();
    const svgBlob = new Blob([graph.svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 8192;
      const scaleW = graph.width > 0 ? Math.min(2, maxDim / graph.width) : 1;
      const scaleH = graph.height > 0 ? Math.min(2, maxDim / graph.height) : 1;
      const dpr = Math.max(0.5, Math.min(scaleW, scaleH));
      canvas.width = Math.round(graph.width * dpr);
      canvas.height = Math.round(graph.height * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, graph.width, graph.height);
        ctx.drawImage(img, 0, 0);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `cpm_aoa_network_${Date.now()}.png`;
        a.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // Safe clamping for glass tooltip inside container bounds computed during event
  const updateTooltipPos = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const tooltipWidth = 260;
    const tooltipHeight = 160;

    let left = relX + 16;
    if (left + tooltipWidth > rect.width - 16) {
      left = relX - tooltipWidth - 16;
    }
    left = Math.max(16, Math.min(rect.width - tooltipWidth - 16, left));

    let top = relY - 40;
    if (top + tooltipHeight > rect.height - 16) {
      top = rect.height - tooltipHeight - 16;
    }
    top = Math.max(16, top);

    setTooltipPos({ x: left, y: top });
  }, []);

  const maxX = useMemo(() => {
    return graph.nodes.reduce((max, n) => Math.max(max, n.x), 1);
  }, [graph.nodes]);

  return (
    <div
      ref={cardRef}
      className="diagram-card"
      id="diagram-section"
    >
      {/* Top Header Bar */}
      <div className="diagram-topbar">
        <div className="diagram-title-area">
          <span className="diagram-title">Network Diagram</span>

          {/* Mini Legend Pill */}
          <div className="diagram-legend">
            <span className="legend-item">
              <span className="legend-line" style={{ background: 'var(--diagram-edge-critical)' }} />
              Critical
            </span>
            <span className="legend-item">
              <span className="legend-line" style={{ background: 'var(--diagram-edge-neutral)' }} />
              Normal
            </span>
            <span className="legend-item">
              <span className="legend-line dashed" />
              Dummy
            </span>
            {timed && (
              <>
                <span className="legend-item" style={{ color: 'var(--e-val)' }}>
                  <span className="legend-dot" style={{ background: 'var(--e-val)' }} />
                  E (Earliest)
                </span>
                <span className="legend-item" style={{ color: 'var(--l-val)' }}>
                  <span className="legend-dot" style={{ background: 'var(--l-val)' }} />
                  L (Latest)
                </span>
              </>
            )}
          </div>

          {isFocusMode && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSelectedEdge(null);
                setHoveredEdge(null);
                setHoveredNode(null);
              }}
              style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', minHeight: '24px' }}
              title="Reset highlighted path or element"
            >
              Reset Focus
            </button>
          )}
        </div>
      </div>

      {/* Interactive SVG Canvas Area */}
      <div
        ref={containerRef}
        className="diagram-canvas-wrapper"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        role="img"
        aria-label="Activity-on-Arrow Network Graph"
      >
        <svg
          ref={svgRef}
          className="diagram-svg"
          width={graph.width}
          height={graph.height}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: isPanning ? 'none' : 'transform var(--duration-fast) var(--ease-out-expo)',
          }}
        >
          <defs>
            {/* Subtle Dot Grid Pattern */}
            <pattern
              id="diagram-dot-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="12" cy="12" r="1.2" fill="var(--diagram-grid-dot)" opacity="0.65" />
            </pattern>

            {/* Normal Arrowhead */}
            <marker
              id="arrowhead-normal"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 z" fill="var(--diagram-edge-neutral)" />
            </marker>

            {/* Critical Arrowhead */}
            <marker
              id="arrowhead-critical"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7.5"
              markerHeight="7.5"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 z" fill="var(--diagram-edge-critical)" />
            </marker>

            {/* Active/Hover Highlight Arrowhead */}
            <marker
              id="arrowhead-highlight"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L9,5 L0,9 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Dot Grid Canvas Surface */}
          <rect width={graph.width} height={graph.height} fill="url(#diagram-dot-grid)" />

          {/* 1. Underpass Bridge Casings (creates clean gaps when lines cross) */}
          {sortedEdges.map((e, index) => {
            const isCrit = timed && e.critical;
            return (
              <path
                key={`underpass-${e.name || ''}-${e.from_}-${e.to}-${index}`}
                d={e.path}
                fill="none"
                stroke="var(--diagram-bg)"
                strokeWidth={isCrit ? 10 : 8}
                strokeLinecap="round"
                style={{ pointerEvents: 'none' }}
              />
            );
          })}

          {/* 2. Directed Activity Arrows */}
          {sortedEdges.map((e, index) => {
            const isCrit = timed && e.critical;
            const inActivePath = activeCriticalPath ? activeCriticalPath.includes(e.name) : false;
            const isSelectedOrHovered = activeEdgeName === e.name;
            const isNodeConnected = hoveredNode
              ? hoveredNode.id === e.from_ || hoveredNode.id === e.to
              : false;
            const isStepHighlight =
              highlightedStepElements?.type === 'critical'
                ? isCrit
                : highlightedStepElements?.edges?.includes(e.name);

            const isActive = inActivePath || isSelectedOrHovered || isNodeConnected || isStepHighlight;
            const opacity = isFocusMode ? (isActive ? 1 : 0.2) : 1;

            let markerId = isCrit ? 'url(#arrowhead-critical)' : 'url(#arrowhead-normal)';
            if (isActive) markerId = 'url(#arrowhead-highlight)';

            // Stagger calculation for drawing animation
            const critIdx = activeCriticalPath ? activeCriticalPath.indexOf(e.name) : -1;
            const drawDelay = isCrit
              ? `${300 + (critIdx >= 0 ? critIdx * 80 : index * 30)}ms`
              : `${120 + (index % 5) * 30}ms`;

            return (
              <g
                key={`edge-${e.name || ''}-${e.from_}-${e.to}-${index}`}
                className="edge-group"
                style={{ opacity }}
              >
                {/* Generous invisible hit target for easy mouse hover/click */}
                <path
                  d={e.path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="24"
                  style={{ cursor: 'pointer' }}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    setSelectedEdge(selectedEdge === e.name ? null : e.name);
                  }}
                  onMouseEnter={(evt) => {
                    updateTooltipPos(evt.clientX, evt.clientY);
                    const actData = actMap.get(e.name);
                    setHoveredEdge({ ...e, actData });
                    setHoveredNode(null);
                  }}
                  onMouseMove={(evt) => {
                    updateTooltipPos(evt.clientX, evt.clientY);
                  }}
                  onMouseLeave={() => setHoveredEdge(null)}
                />

                {/* Visible Path with dynamic length & animation */}
                <path
                  ref={(el) => {
                    if (el) pathRefs.current.set(e.name, el);
                    else pathRefs.current.delete(e.name);
                  }}
                  d={e.path}
                  markerEnd={markerId}
                  className={`edge-path ${isCrit ? 'is-critical anim-critical-draw' : 'anim-draw'} ${
                    e.dummy ? 'is-dummy' : ''
                  } ${isActive ? 'is-active' : ''}`}
                  style={
                    {
                      '--draw-delay': drawDelay,
                    } as React.CSSProperties
                  }
                />
              </g>
            );
          })}

          {/* 3. Edge Label Badges */}
          {sortedEdges.map((e, index) => {
            const isCrit = timed && e.critical;
            const inActivePath = activeCriticalPath ? activeCriticalPath.includes(e.name) : false;
            const isSelectedOrHovered = activeEdgeName === e.name;
            const isNodeConnected = hoveredNode
              ? hoveredNode.id === e.from_ || hoveredNode.id === e.to
              : false;
            const isStepHighlight =
              highlightedStepElements?.type === 'critical'
                ? isCrit
                : highlightedStepElements?.edges?.includes(e.name);

            const isActive = inActivePath || isSelectedOrHovered || isNodeConnected || isStepHighlight;
            const opacity = isFocusMode ? (isActive ? 1 : 0.22) : 1;

            const labelText = e.dummy
              ? e.name
              : e.duration !== null
              ? `${e.name} (${e.duration})`
              : e.name;
            const badgeWidth = Math.max(38, labelText.length * 7.2 + 16);

            return (
              <g
                key={`badge-${e.name || ''}-${e.from_}-${e.to}-${index}`}
                className={`edge-badge-group ${isCrit ? 'is-critical' : ''} ${
                  isActive ? 'is-active' : ''
                }`}
                transform={`translate(${e.label_x}, ${e.label_y})`}
                style={{ opacity }}
                onClick={(evt) => {
                  evt.stopPropagation();
                  setSelectedEdge(selectedEdge === e.name ? null : e.name);
                }}
                onMouseEnter={(evt) => {
                  updateTooltipPos(evt.clientX, evt.clientY);
                  const actData = actMap.get(e.name);
                  setHoveredEdge({ ...e, actData });
                  setHoveredNode(null);
                }}
                onMouseMove={(evt) => {
                  updateTooltipPos(evt.clientX, evt.clientY);
                }}
                onMouseLeave={() => setHoveredEdge(null)}
              >
                <rect
                  className="edge-badge-rect"
                  x={-badgeWidth / 2}
                  y={-11}
                  width={badgeWidth}
                  height={22}
                />
                <text
                  className={`edge-badge-text ${isCrit ? 'is-critical' : ''} ${
                    isActive ? 'is-active' : ''
                  }`}
                  x={0}
                  y={4}
                  textAnchor="middle"
                >
                  {labelText}
                </text>
              </g>
            );
          })}

          {/* 4. Event Nodes */}
          {graph.nodes.map((n) => {
            const isHovered = hoveredNode?.id === n.id;
            const isNodeConnected = activeEdgeName
              ? hoveredEdge?.from_ === n.id ||
                hoveredEdge?.to === n.id ||
                selectedEdgeData?.from_ === n.id ||
                selectedEdgeData?.to === n.id
              : false;
            const isStepHighlight =
              highlightedStepElements?.nodes?.includes(n.id) ||
              (highlightedStepElements?.type === 'forward' && n.E !== null) ||
              (highlightedStepElements?.type === 'backward' && n.L !== null);

            const isActive = isHovered || isNodeConnected || isStepHighlight;
            const opacity = isFocusMode ? (isActive ? 1 : 0.28) : 1;

            // Topological pop-in stagger based on x coordinate
            const popDelay = `${Math.round((n.x / maxX) * 280)}ms`;

            return (
              <g
                key={`node-${n.id}`}
                className={`node-group anim-node-pop ${isActive ? 'is-active' : ''}`}
                style={
                  {
                    opacity,
                    '--pop-delay': popDelay,
                  } as React.CSSProperties
                }
                onMouseEnter={(evt) => {
                  updateTooltipPos(evt.clientX, evt.clientY);
                  setHoveredNode(n);
                  setHoveredEdge(null);
                }}
                onMouseMove={(evt) => {
                  updateTooltipPos(evt.clientX, evt.clientY);
                }}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Node Circle */}
                <circle
                  className="node-circle"
                  cx={n.x}
                  cy={n.y}
                  r="23"
                />

                {/* Event ID Number */}
                <text
                  className="node-id"
                  x={n.x}
                  y={n.y + 5.5}
                  textAnchor="middle"
                >
                  {n.id}
                </text>

                {/* E | L Values in a neat rounded pill below circle */}
                {timed && n.E !== null && n.L !== null && (
                  <g transform={`translate(${n.x}, ${n.y + 36})`}>
                    <rect
                      className="node-pill"
                      x={-28}
                      y={-9}
                      width={56}
                      height={18}
                      rx={6}
                    />
                    <text
                      className="node-time-text"
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                    >
                      <tspan fill="var(--e-val)">{n.E}</tspan>
                      <tspan fill="var(--text-tertiary)"> | </tspan>
                      <tspan fill="var(--l-val)">{n.L}</tspan>
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Floating Glass Toolbar */}
        <div className="diagram-floating-toolbar" role="toolbar" aria-label="Diagram Navigation">
          <button
            type="button"
            className="diagram-tool-btn"
            onClick={() => handleZoom(0.18)}
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomInIcon size={16} />
          </button>
          <button
            type="button"
            className="diagram-tool-btn"
            onClick={() => handleZoom(-0.18)}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOutIcon size={16} />
          </button>
          <button
            type="button"
            className="diagram-tool-btn"
            onClick={resetView}
            title="Fit to Canvas"
            aria-label="Reset View"
          >
            <ResetIcon size={15} />
          </button>

          <div className="diagram-divider" />

          <button
            type="button"
            className="diagram-tool-btn"
            onClick={downloadSVG}
            title="Download SVG vector"
            aria-label="Download SVG"
          >
            <DownloadIcon size={15} />
          </button>
          <button
            type="button"
            className="diagram-tool-btn"
            onClick={downloadPNG}
            title="Download PNG image"
            aria-label="Download PNG"
          >
            <span style={{ fontSize: '10px', fontWeight: 700 }}>PNG</span>
          </button>
        </div>

        {/* Hover Popover Tooltip for Arrow/Activity */}
        {hoveredEdge && (
          <div className="diagram-glass-tooltip" style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}>
            <div className="diagram-tooltip-header">
              <span className="diagram-tooltip-title">
                Activity {hoveredEdge.name} {hoveredEdge.dummy && '(Dummy)'}
              </span>
              {timed && hoveredEdge.critical && (
                <span className="badge badge-critical" style={{ fontSize: '10px', height: '20px' }}>
                  Critical
                </span>
              )}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '6px' }}>
              From event {hoveredEdge.from_} → {hoveredEdge.to}
              {hoveredEdge.actData?.description ? ` • ${hoveredEdge.actData.description}` : ''}
            </div>

            {timed && hoveredEdge.actData && (
              <div className="diagram-tooltip-stats">
                <div className="diagram-tooltip-stat"><span>Duration:</span> <strong>{hoveredEdge.duration ?? 0}</strong></div>
                <div className="diagram-tooltip-stat"><span>Total Float:</span> <strong>{hoveredEdge.actData.total_float ?? 0}</strong></div>
                <div className="diagram-tooltip-stat"><span>ES:</span> <strong>{hoveredEdge.actData.ES}</strong></div>
                <div className="diagram-tooltip-stat"><span>EF:</span> <strong>{hoveredEdge.actData.EF}</strong></div>
                <div className="diagram-tooltip-stat"><span>LS:</span> <strong>{hoveredEdge.actData.LS}</strong></div>
                <div className="diagram-tooltip-stat"><span>LF:</span> <strong>{hoveredEdge.actData.LF}</strong></div>
                <div className="diagram-tooltip-stat"><span>Free Float:</span> <strong>{hoveredEdge.actData.free_float ?? 0}</strong></div>
                <div className="diagram-tooltip-stat"><span>Interfering:</span> <strong>{hoveredEdge.actData.interfering_float ?? 0}</strong></div>
              </div>
            )}
          </div>
        )}

        {/* Hover Popover Tooltip for Event Node */}
        {hoveredNode && timed && (
          <div className="diagram-glass-tooltip" style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}>
            <div className="diagram-tooltip-header">
              <span className="diagram-tooltip-title">Event Node {hoveredNode.id}</span>
            </div>
            <div className="diagram-tooltip-stats" style={{ gridTemplateColumns: '1fr' }}>
              <div className="diagram-tooltip-stat">
                <span style={{ color: 'var(--e-val)', fontWeight: 600 }}>Earliest Event Time (E):</span>
                <strong>{hoveredNode.E}</strong>
              </div>
              <div className="diagram-tooltip-stat">
                <span style={{ color: 'var(--l-val)', fontWeight: 600 }}>Latest Event Time (L):</span>
                <strong>{hoveredNode.L}</strong>
              </div>
              <div className="diagram-tooltip-stat" style={{ borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Event Slack (L − E):</span>
                <strong>{hoveredNode.slack ?? (hoveredNode.L !== null && hoveredNode.E !== null ? hoveredNode.L - hoveredNode.E : '–')}</strong>
              </div>
            </div>
          </div>
        )}

        {/* Pinned Inspector Card for clicked activity */}
        {selectedEdge && selectedEdgeData && (
          <div className="diagram-pinned-inspector">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>
                  Activity {selectedEdge}
                </strong>
                {selectedEdgeData.dummy && <span className="badge badge-neutral" style={{ fontSize: '10px', height: '20px' }}>Dummy</span>}
                {timed && selectedEdgeData.critical && <span className="badge badge-critical" style={{ fontSize: '10px', height: '20px' }}>Critical</span>}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                Event {selectedEdgeData.from_} → {selectedEdgeData.to} • Duration {selectedEdgeData.duration ?? 0}
                {actMap.get(selectedEdge)?.total_float !== undefined && (
                  <span> • Float: TF {actMap.get(selectedEdge)?.total_float} / FF {actMap.get(selectedEdge)?.free_float}</span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelectedEdge(null)}
              style={{ fontSize: 'var(--text-xs)', padding: '4px 10px', minHeight: '26px' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
