import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ClaimType, ProcessedClaim, RiskSegment } from '../../types/claims';

// Scarlet Snow accessible, colorblind-safe palette
export const RISK_COLORS: Record<RiskSegment, string> = {
  'Low Risk': '#0D9488',
  'Medium Risk': '#D97706',
  'High Risk': '#DC2626',
};

export const CLAIM_TYPE_COLORS: Record<ClaimType, string> = {
  Inpatient: '#DC2626',
  Outpatient: '#0D9488',
  Pharmacy: '#D97706',
  Diagnostics: '#6D28D9',
};

export function useIsDarkTheme() {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 540) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 100) setWidth(el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[];
}

export function ChartTooltip({ tip }: { tip: TooltipState }) {
  if (!tip.visible) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 bg-popover text-popover-foreground px-3 py-2 rounded-lg text-xs border border-border shadow-md max-w-xs"
      style={{
        left: `${Math.min(tip.x + 12, 520)}px`,
        top: `${Math.max(tip.y - 12, 8)}px`,
      }}
    >
      <div className="font-semibold text-foreground">{tip.title}</div>
      {tip.lines.map((line, idx) => (
        <div key={idx} className="text-muted-foreground font-mono tabular-nums mt-0.5">
          {line}
        </div>
      ))}
    </div>
  );
}

export function RiskDonutChart({
  counts,
  title = 'Risk Segment Share',
}: {
  counts: { segment: RiskSegment; count: number; amount: number }[];
  title?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 360);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: '', lines: [] });

  const total = counts.reduce((s, d) => s + d.count, 0);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (total === 0) return;

    const size = Math.min(width, 220);
    const radius = size / 2 - 8;
    const g = svg
      .attr('width', size)
      .attr('height', size)
      .append('g')
      .attr('transform', `translate(${size / 2}, ${size / 2})`);

    const pie = d3
      .pie<{ segment: RiskSegment; count: number; amount: number }>()
      .sort(null)
      .value((d) => d.count);

    const arc = d3
      .arc<d3.PieArcDatum<{ segment: RiskSegment; count: number; amount: number }>>()
      .innerRadius(radius * 0.62)
      .outerRadius(radius);

    g.selectAll('path')
      .data(pie(counts))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d) => RISK_COLORS[d.data.segment])
      .attr('stroke', 'var(--card)')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        const pct = ((d.data.count / total) * 100).toFixed(1);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: d.data.segment,
          lines: [
            `Claims: ${d.data.count.toLocaleString()} (${pct}%)`,
            `Exposure: $${Math.round(d.data.amount).toLocaleString()}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.2em')
      .attr('class', 'fill-foreground font-semibold text-lg font-mono tabular-nums')
      .text(total.toLocaleString());

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.2em')
      .attr('class', 'fill-muted-foreground text-[11px]')
      .text('Total Claims');
  }, [counts, total, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <div className="text-sm font-semibold text-foreground mb-3">{title}</div>
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <svg ref={svgRef} role="img" aria-label={title} className="shrink-0" />
        <div className="flex-1 w-full space-y-2.5">
          {counts.map((item) => {
            const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0';
            return (
              <div
                key={item.segment}
                className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: RISK_COLORS[item.segment] }}
                  />
                  <span className="font-medium text-foreground">{item.segment}</span>
                </div>
                <div className="font-mono tabular-nums text-foreground">
                  {item.count.toLocaleString()}{' '}
                  <span className="text-muted-foreground">({pct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function RiskExposureBarChart({
  counts,
}: {
  counts: { segment: RiskSegment; count: number; amount: number }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 460);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: '', lines: [] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const height = 220;
    const margin = { top: 16, right: 20, bottom: 32, left: 68 };
    const innerW = Math.max(width - margin.left - margin.right, 120);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(counts.map((d) => d.segment))
      .range([0, innerW])
      .padding(0.36);

    const maxAmt = d3.max(counts, (d) => d.amount) ?? 1000;
    const y = d3.scaleLinear().domain([0, maxAmt * 1.15]).nice().range([innerH, 0]);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(d3.axisBottom(x))
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-xs fill-foreground'));

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((v) => `$${Math.round(Number(v) / 1000)}k`),
      )
      .call((ax) => ax.select('.domain').remove())
      .call((ax) =>
        ax.selectAll('.tick line').clone().attr('x2', innerW).attr('stroke', 'var(--chart-grid)'),
      )
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.selectAll('rect.bar')
      .data(counts)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.segment) ?? 0)
      .attr('y', (d) => y(d.amount))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.max(0, innerH - y(d.amount)))
      .attr('rx', 4)
      .attr('fill', (d) => RISK_COLORS[d.segment])
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: d.segment,
          lines: [
            `Total Exposure: $${Math.round(d.amount).toLocaleString()}`,
            `Claim Count: ${d.count.toLocaleString()}`,
            `Avg Claim: $${d.count > 0 ? Math.round(d.amount / d.count).toLocaleString() : '0'}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
  }, [counts, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <div className="text-sm font-semibold text-foreground mb-3">
        Total Dollar Exposure by Risk Segment
      </div>
      <svg ref={svgRef} role="img" aria-label="Total Dollar Exposure by Risk Segment" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function ClaimTypeDonutChart({ claims }: { claims: ProcessedClaim[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 380);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: '', lines: [] });

  const types: ClaimType[] = ['Inpatient', 'Outpatient', 'Pharmacy', 'Diagnostics'];
  const summary = types.map((t) => {
    const subset = claims.filter((c) => c.claimType === t);
    return {
      type: t,
      count: subset.length,
      amount: subset.reduce((s, c) => s + c.amount, 0),
    };
  });
  const totalAmt = summary.reduce((s, d) => s + d.amount, 0);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (totalAmt <= 0) return;

    const size = Math.min(width, 220);
    const radius = size / 2 - 8;
    const g = svg
      .attr('width', size)
      .attr('height', size)
      .append('g')
      .attr('transform', `translate(${size / 2}, ${size / 2})`);

    const pie = d3
      .pie<{ type: ClaimType; count: number; amount: number }>()
      .sort(null)
      .value((d) => d.amount);

    const arc = d3
      .arc<d3.PieArcDatum<{ type: ClaimType; count: number; amount: number }>>()
      .innerRadius(radius * 0.62)
      .outerRadius(radius);

    g.selectAll('path')
      .data(pie(summary))
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d) => CLAIM_TYPE_COLORS[d.data.type])
      .attr('stroke', 'var(--card)')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        const pct = ((d.data.amount / totalAmt) * 100).toFixed(1);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: d.data.type,
          lines: [
            `Share of Spend: ${pct}%`,
            `Total Paid: $${Math.round(d.data.amount).toLocaleString()}`,
            `Claims: ${d.data.count.toLocaleString()}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.15em')
      .attr('class', 'fill-foreground font-semibold text-base font-mono tabular-nums')
      .text(`$${Math.round(totalAmt / 1000).toLocaleString()}k`);

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1.2em')
      .attr('class', 'fill-muted-foreground text-[11px]')
      .text('Incurred Spend');
  }, [summary, totalAmt, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <svg ref={svgRef} role="img" aria-label="Claim Type Spend Proportion" className="shrink-0" />
        <div className="flex-1 w-full space-y-2.5">
          {summary.map((item) => {
            const pct = totalAmt > 0 ? ((item.amount / totalAmt) * 100).toFixed(1) : '0.0';
            return (
              <div
                key={item.type}
                className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-b-0"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: CLAIM_TYPE_COLORS[item.type] }}
                  />
                  <span className="font-medium text-foreground">{item.type}</span>
                </div>
                <div className="font-mono tabular-nums text-foreground">
                  {pct}%{' '}
                  <span className="text-muted-foreground">
                    (${Math.round(item.amount).toLocaleString()})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}
