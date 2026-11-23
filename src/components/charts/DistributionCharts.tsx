import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BoxPlotStats } from '../../lib/claimsEngine';
import { ClaimType, ProcessedClaim } from '../../types/claims';
import { ChartTooltip, CLAIM_TYPE_COLORS, useContainerWidth, useIsDarkTheme } from './D3Charts';

export function AmountHistogramChart({
  claims,
  binCount = 16,
}: {
  claims: ProcessedClaim[];
  binCount?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 560);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (claims.length === 0) return;

    const height = 270;
    const margin = { top: 20, right: 20, bottom: 38, left: 52 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const amounts = claims.map((c) => c.amount);
    const maxVal = d3.max(amounts) ?? 1000;
    const x = d3.scaleLinear().domain([0, maxVal]).nice().range([0, innerW]);

    const histogram = d3
      .bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(x.ticks(binCount));

    const bins = histogram(amounts);
    const yMax = d3.max(bins, (b) => b.length) ?? 1;
    const y = d3.scaleLinear().domain([0, yMax * 1.12]).nice().range([innerH, 0]);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((v) => `$${Math.round(Number(v) / 1000)}k`),
      )
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .call((ax) => ax.select('.domain').remove())
      .call((ax) =>
        ax.selectAll('.tick line').clone().attr('x2', innerW).attr('stroke', 'var(--chart-grid)'),
      )
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.selectAll('rect.hist-bar')
      .data(bins)
      .enter()
      .append('rect')
      .attr('class', 'hist-bar')
      .attr('x', (d) => x(d.x0 ?? 0) + 1)
      .attr('y', (d) => y(d.length))
      .attr('width', (d) => Math.max(1, x(d.x1 ?? 0) - x(d.x0 ?? 0) - 2))
      .attr('height', (d) => Math.max(0, innerH - y(d.length)))
      .attr('rx', 2)
      .attr('fill', 'var(--chart-scarlet)')
      .attr('fill-opacity', 0.85)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `$${Math.round(d.x0 ?? 0).toLocaleString()} – $${Math.round(d.x1 ?? 0).toLocaleString()}`,
          lines: [
            `Claims in Bin: ${d.length.toLocaleString()}`,
            `Share: ${((d.length / claims.length) * 100).toFixed(1)}%`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

    // Mean & Median Markers
    const meanVal = d3.mean(amounts) ?? 0;
    const medianVal = d3.median(amounts) ?? 0;

    [
      { label: `Median $${Math.round(medianVal).toLocaleString()}`, val: medianVal, color: 'var(--chart-teal)', dash: '4,3' },
      { label: `Mean $${Math.round(meanVal).toLocaleString()}`, val: meanVal, color: 'var(--chart-amber)', dash: '2,2' },
    ].forEach((m, idx) => {
      const px = x(m.val);
      g.append('line')
        .attr('x1', px)
        .attr('x2', px)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', m.color)
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', m.dash);

      g.append('text')
        .attr('x', Math.min(px + 6, innerW - 110))
        .attr('y', 12 + idx * 14)
        .attr('class', 'text-[11px] font-mono font-medium')
        .attr('fill', m.color)
        .text(m.label);
    });
  }, [claims, binCount, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Claim Amount Distribution Histogram" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function BoxPlotChart({ stats }: { stats: BoxPlotStats[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 560);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const active = stats.filter((s) => s.count > 0);
    if (active.length === 0) return;

    const height = 270;
    const margin = { top: 18, right: 24, bottom: 34, left: 108 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const maxVal = d3.max(active, (s) => Math.max(s.max, ...(s.outliers ?? [0]))) ?? 1000;
    const x = d3.scaleLinear().domain([0, maxVal * 1.05]).nice().range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(active.map((s) => s.group))
      .range([0, innerH])
      .padding(0.42);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((v) => `$${Math.round(Number(v) / 1000)}k`),
      )
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.append('g')
      .call(d3.axisLeft(y))
      .call((ax) => ax.select('.domain').remove())
      .call((ax) => ax.selectAll('text').attr('class', 'text-xs font-medium fill-foreground'));

    // Grid lines
    g.append('g')
      .selectAll('line')
      .data(x.ticks(5))
      .enter()
      .append('line')
      .attr('x1', (d) => x(d))
      .attr('x2', (d) => x(d))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', 'var(--chart-grid)');

    active.forEach((s) => {
      const cy = (y(s.group) ?? 0) + y.bandwidth() / 2;
      const boxH = y.bandwidth();
      const color = CLAIM_TYPE_COLORS[s.group as ClaimType] ?? 'var(--chart-scarlet)';

      // Whisker line
      g.append('line')
        .attr('x1', x(s.min))
        .attr('x2', x(s.max))
        .attr('y1', cy)
        .attr('y2', cy)
        .attr('stroke', 'var(--muted-foreground)')
        .attr('stroke-width', 1.5);

      // Whisker caps
      [s.min, s.max].forEach((endVal) => {
        g.append('line')
          .attr('x1', x(endVal))
          .attr('x2', x(endVal))
          .attr('y1', cy - boxH * 0.25)
          .attr('y2', cy + boxH * 0.25)
          .attr('stroke', 'var(--muted-foreground)')
          .attr('stroke-width', 1.5);
      });

      // IQR Box
      g.append('rect')
        .attr('x', x(s.q1))
        .attr('y', cy - boxH / 2)
        .attr('width', Math.max(2, x(s.q3) - x(s.q1)))
        .attr('height', boxH)
        .attr('fill', color)
        .attr('fill-opacity', 0.22)
        .attr('stroke', color)
        .attr('stroke-width', 1.75)
        .attr('rx', 3)
        .style('cursor', 'pointer')
        .on('mousemove', (event) => {
          const [mx, my] = d3.pointer(event, containerRef.current);
          setTip({
            visible: true,
            x: mx,
            y: my,
            title: `${s.group} (n=${s.count})`,
            lines: [
              `Q1: $${Math.round(s.q1).toLocaleString()} · Median: $${Math.round(s.median).toLocaleString()}`,
              `Q3: $${Math.round(s.q3).toLocaleString()} · Mean: $${Math.round(s.mean).toLocaleString()}`,
              `Outliers: ${s.outliers.length}`,
            ],
          });
        })
        .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

      // Median line
      g.append('line')
        .attr('x1', x(s.median))
        .attr('x2', x(s.median))
        .attr('y1', cy - boxH / 2)
        .attr('y2', cy + boxH / 2)
        .attr('stroke', color)
        .attr('stroke-width', 2.5);

      // Outliers
      s.outliers.slice(0, 35).forEach((ov) => {
        g.append('circle')
          .attr('cx', x(ov))
          .attr('cy', cy)
          .attr('r', 3)
          .attr('fill', 'var(--chart-scarlet)')
          .attr('fill-opacity', 0.8)
          .attr('stroke', 'var(--card)')
          .attr('stroke-width', 0.75);
      });
    });
  }, [stats, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Claim Amount Box Plot by Category" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function EcdfCurveChart({ claims }: { claims: ProcessedClaim[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 560);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (claims.length === 0) return;

    const height = 250;
    const margin = { top: 18, right: 24, bottom: 36, left: 52 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const sorted = [...claims.map((c) => c.amount)].sort((a, b) => a - b);
    const points = sorted.map((val, i) => ({
      amount: val,
      cdf: ((i + 1) / sorted.length) * 100,
    }));

    const x = d3.scaleLinear().domain([0, sorted[sorted.length - 1]]).nice().range([0, innerW]);
    const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((v) => `$${Math.round(Number(v) / 1000)}k`),
      )
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`))
      .call((ax) => ax.select('.domain').remove())
      .call((ax) =>
        ax.selectAll('.tick line').clone().attr('x2', innerW).attr('stroke', 'var(--chart-grid)'),
      )
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    const line = d3
      .line<{ amount: number; cdf: number }>()
      .x((d) => x(d.amount))
      .y((d) => y(d.cdf))
      .curve(d3.curveStepAfter);

    const area = d3
      .area<{ amount: number; cdf: number }>()
      .x((d) => x(d.amount))
      .y0(innerH)
      .y1((d) => y(d.cdf))
      .curve(d3.curveStepAfter);

    g.append('path').datum(points).attr('d', area).attr('fill', 'var(--chart-teal)').attr('fill-opacity', 0.12);
    g.append('path')
      .datum(points)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', 'var(--chart-teal)')
      .attr('stroke-width', 2);

    // P50 and P95 reference hairlines
    [50, 95].forEach((pct) => {
      const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
      const val = sorted[idx];
      g.append('line')
        .attr('x1', 0)
        .attr('x2', x(val))
        .attr('y1', y(pct))
        .attr('y2', y(pct))
        .attr('stroke', pct === 95 ? 'var(--chart-scarlet)' : 'var(--foreground)')
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-width', 1.25);

      g.append('text')
        .attr('x', 8)
        .attr('y', y(pct) - 5)
        .attr('class', 'text-[10px] font-mono font-medium')
        .attr('fill', pct === 95 ? 'var(--chart-scarlet)' : 'var(--foreground)')
        .text(`P${pct}: $${Math.round(val).toLocaleString()}`);
    });

    // Hover overlay
    const bisect = d3.bisector<{ amount: number; cdf: number }, number>((d) => d.amount).left;
    g.append('rect')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [px] = d3.pointer(event);
        const [mx, my] = d3.pointer(event, containerRef.current);
        const targetAmt = x.invert(px);
        const idx = Math.min(points.length - 1, Math.max(0, bisect(points, targetAmt)));
        const pt = points[idx];
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `Cumulative Percentile: ${pt.cdf.toFixed(1)}%`,
          lines: [`Claim Amount ≤ $${Math.round(pt.amount).toLocaleString()}`],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
  }, [claims, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Cumulative Distribution Function ECDF" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function ClaimTypeStackedBarChart({
  claims,
  groupBy,
  mode,
}: {
  claims: ProcessedClaim[];
  groupBy: 'region' | 'riskSegment' | 'ageGroup';
  mode: 'percent' | 'amount';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 560);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (claims.length === 0) return;

    const types: ClaimType[] = ['Inpatient', 'Outpatient', 'Pharmacy', 'Diagnostics'];
    const groups = Array.from(new Set(claims.map((c) => c[groupBy]))).sort();

    const rows = groups.map((grp) => {
      const subset = claims.filter((c) => c[groupBy] === grp);
      const totalAmt = subset.reduce((s, c) => s + c.amount, 0);
      const rec: Record<string, number | string> = { group: String(grp), totalAmt };
      for (const t of types) {
        const amt = subset.filter((c) => c.claimType === t).reduce((s, c) => s + c.amount, 0);
        rec[t] = mode === 'percent' ? (totalAmt > 0 ? (amt / totalAmt) * 100 : 0) : amt;
      }
      return rec;
    });

    const height = 260;
    const margin = { top: 18, right: 20, bottom: 38, left: 60 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const x = d3
      .scaleBand()
      .domain(groups.map(String))
      .range([0, innerW])
      .padding(0.32);

    const maxY =
      mode === 'percent'
        ? 100
        : d3.max(rows, (r) => Number(r.totalAmt)) ?? 1000;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([innerH, 0]);

    const stack = d3.stack<Record<string, number | string>>().keys(types);
    const series = stack(rows);

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
          .tickFormat((v) =>
            mode === 'percent' ? `${v}%` : `$${Math.round(Number(v) / 1000)}k`,
          ),
      )
      .call((ax) => ax.select('.domain').remove())
      .call((ax) =>
        ax.selectAll('.tick line').clone().attr('x2', innerW).attr('stroke', 'var(--chart-grid)'),
      )
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    series.forEach((layer) => {
      const claimType = layer.key as ClaimType;
      g.selectAll(`rect.stack-${claimType}`)
        .data(layer)
        .enter()
        .append('rect')
        .attr('x', (d) => x(String(d.data.group)) ?? 0)
        .attr('y', (d) => y(d[1]))
        .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
        .attr('width', x.bandwidth())
        .attr('fill', CLAIM_TYPE_COLORS[claimType])
        .style('cursor', 'pointer')
        .on('mousemove', (event, d) => {
          const [mx, my] = d3.pointer(event, containerRef.current);
          const val = d[1] - d[0];
          setTip({
            visible: true,
            x: mx,
            y: my,
            title: `${d.data.group} · ${claimType}`,
            lines: [
              mode === 'percent'
                ? `Spend Share: ${val.toFixed(1)}%`
                : `Total Spend: $${Math.round(val).toLocaleString()}`,
            ],
          });
        })
        .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
    });
  }, [claims, groupBy, mode, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Claim Type Stacked Bar Chart" />
      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
        {(['Inpatient', 'Outpatient', 'Pharmacy', 'Diagnostics'] as ClaimType[]).map((t) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: CLAIM_TYPE_COLORS[t] }} />
            <span>{t}</span>
          </div>
        ))}
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}
