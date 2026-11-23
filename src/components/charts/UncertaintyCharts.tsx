import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { MonteCarloSummary, ProcessedClaim, RiskSegment } from '../../types/claims';
import { ChartTooltip, RISK_COLORS, useContainerWidth, useIsDarkTheme } from './D3Charts';

export interface TimeSeriesPoint {
  period: string;
  totalAmount: number;
  avgCost: number;
  claimCount: number;
  isFluSeason: boolean;
}

export function TimeSeriesTrendChart({
  data,
  metric,
  highlightFluSeason,
}: {
  data: TimeSeriesPoint[];
  metric: 'totalAmount' | 'avgCost' | 'claimCount';
  highlightFluSeason: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 640);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (data.length === 0) return;

    const height = 270;
    const margin = { top: 20, right: 24, bottom: 38, left: 68 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const x = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.period))
      .range([0, innerW])
      .padding(0.35);

    const maxVal = d3.max(data, (d) => d[metric]) ?? 100;
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).nice().range([innerH, 0]);

    // Shaded Flu Season regions (Nov-Mar)
    if (highlightFluSeason) {
      const bandWidth = data.length > 1 ? innerW / data.length : 30;
      data.forEach((d) => {
        if (d.isFluSeason) {
          const cx = x(d.period) ?? 0;
          g.append('rect')
            .attr('x', Math.max(0, cx - bandWidth / 2))
            .attr('y', 0)
            .attr('width', bandWidth)
            .attr('height', innerH)
            .attr('fill', 'var(--chart-flu-band)');
        }
      });
    }

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(d3.axisBottom(x))
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((v) =>
            metric === 'claimCount'
              ? `${v}`
              : Number(v) >= 1000
                ? `$${Math.round(Number(v) / 1000)}k`
                : `$${v}`,
          ),
      )
      .call((ax) => ax.select('.domain').remove())
      .call((ax) =>
        ax.selectAll('.tick line').clone().attr('x2', innerW).attr('stroke', 'var(--chart-grid)'),
      )
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    const area = d3
      .area<TimeSeriesPoint>()
      .x((d) => x(d.period) ?? 0)
      .y0(innerH)
      .y1((d) => y(d[metric]))
      .curve(d3.curveMonotoneX);

    const line = d3
      .line<TimeSeriesPoint>()
      .x((d) => x(d.period) ?? 0)
      .y((d) => y(d[metric]))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('d', area)
      .attr('fill', 'var(--chart-scarlet)')
      .attr('fill-opacity', 0.12);
    g.append('path')
      .datum(data)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', 'var(--chart-scarlet)')
      .attr('stroke-width', 2.25);

    g.selectAll('circle.pt')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'pt')
      .attr('cx', (d) => x(d.period) ?? 0)
      .attr('cy', (d) => y(d[metric]))
      .attr('r', 4.5)
      .attr('fill', (d) =>
        d.isFluSeason && highlightFluSeason ? 'var(--chart-amber)' : 'var(--chart-scarlet)',
      )
      .attr('stroke', 'var(--card)')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `${d.period}${d.isFluSeason ? ' · Flu Season Window' : ''}`,
          lines: [
            `Total Claims: ${d.claimCount.toLocaleString()}`,
            `Total Paid: $${Math.round(d.totalAmount).toLocaleString()}`,
            `Avg Claim Cost: $${Math.round(d.avgCost).toLocaleString()}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
  }, [data, metric, highlightFluSeason, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Claims Time-Series Trend Chart" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function CorrelationHeatmapChart({
  labels,
  matrix,
}: {
  labels: string[];
  matrix: number[][];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 440);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const n = labels.length;
    const height = 280;
    const margin = { top: 28, right: 16, bottom: 24, left: 102 };
    const gridSize = Math.min(width - margin.left - margin.right, height - margin.top - margin.bottom);
    const cellSize = Math.max(24, gridSize / n);

    const g = svg
      .attr('width', margin.left + cellSize * n + margin.right)
      .attr('height', margin.top + cellSize * n + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Colorblind-safe diverging scale: Teal (-1) -> Neutral Card (0) -> Scarlet (+1)
    const zeroColor = isDark ? '#262626' : '#FAFAFA';
    const textNeutral = isDark ? '#F5F5F5' : '#171717';
    const colorScale = d3
      .scaleLinear<string>()
      .domain([-1, 0, 1])
      .range(['#0D9488', zeroColor, '#DC2626']);

    for (let i = 0; i < n; i += 1) {
      g.append('text')
        .attr('x', -8)
        .attr('y', i * cellSize + cellSize / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('class', 'text-[11px] font-medium fill-foreground')
        .text(labels[i]);

      g.append('text')
        .attr('x', i * cellSize + cellSize / 2)
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .attr('class', 'text-[10px] font-medium fill-foreground')
        .text(labels[i].split(' ')[0]);

      for (let j = 0; j < n; j += 1) {
        const val = matrix[i]?.[j] ?? 0;
        const absVal = Math.abs(val);

        g.append('rect')
          .attr('x', j * cellSize + 1)
          .attr('y', i * cellSize + 1)
          .attr('width', cellSize - 2)
          .attr('height', cellSize - 2)
          .attr('rx', 3)
          .attr('fill', colorScale(val))
          .attr('stroke', 'var(--border)')
          .style('cursor', 'pointer')
          .on('mousemove', (event) => {
            const [mx, my] = d3.pointer(event, containerRef.current);
            setTip({
              visible: true,
              x: mx,
              y: my,
              title: `${labels[i]} × ${labels[j]}`,
              lines: [`Pearson r = ${val.toFixed(2)}`],
            });
          })
          .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

        g.append('text')
          .attr('x', j * cellSize + cellSize / 2)
          .attr('y', i * cellSize + cellSize / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr('class', 'text-[11px] font-mono tabular-nums pointer-events-none')
          .attr('fill', absVal > 0.48 ? '#ffffff' : textNeutral)
          .text(val.toFixed(2));
      }
    }
  }, [labels, matrix, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Cost Factor Correlation Matrix Heatmap" />
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function AgeAmountScatterChart({ claims }: { claims: ProcessedClaim[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 520);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    if (claims.length === 0) return;

    const height = 280;
    const margin = { top: 18, right: 20, bottom: 38, left: 64 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const x = d3.scaleLinear().domain([0, 95]).range([0, innerW]);
    const maxAmt = d3.max(claims, (c) => c.amount) ?? 10000;
    const y = d3.scaleLinear().domain([0, maxAmt * 1.08]).nice().range([innerH, 0]);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(d3.axisBottom(x).ticks(6))
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

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

    const symbolMap: Record<RiskSegment, d3.SymbolType> = {
      'Low Risk': d3.symbolCircle,
      'Medium Risk': d3.symbolSquare,
      'High Risk': d3.symbolDiamond,
    };

    g.selectAll('path.dot')
      .data(claims.slice(0, 350))
      .enter()
      .append('path')
      .attr('class', 'dot')
      .attr('transform', (d) => `translate(${x(d.patientAge)}, ${y(d.amount)})`)
      .attr('d', (d) => d3.symbol().type(symbolMap[d.riskSegment]).size(38)() ?? '')
      .attr('fill', (d) => RISK_COLORS[d.riskSegment])
      .attr('fill-opacity', 0.78)
      .attr('stroke', 'var(--card)')
      .attr('stroke-width', 0.75)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `${d.claimId} · ${d.riskSegment}`,
          lines: [
            `Age: ${d.patientAge} · Comorbidities: ${d.comorbidities}`,
            `Amount: $${d.amount.toLocaleString()} (${d.claimType})`,
            `ICD-10: ${d.icd10Code} · ${d.region}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
  }, [claims, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Patient Age vs Claim Amount Scatter Plot" />
      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: RISK_COLORS['Low Risk'] }}>●</span> Low Risk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: RISK_COLORS['Medium Risk'] }}>■</span> Medium Risk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: RISK_COLORS['High Risk'] }}>◆</span> High Risk
        </span>
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function MonteCarloFanChart({ summary }: { summary: MonteCarloSummary }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 580);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const fan = summary.monthlyFan;
    if (fan.length === 0) return;

    const height = 260;
    const margin = { top: 18, right: 24, bottom: 36, left: 68 };
    const innerW = Math.max(width - margin.left - margin.right, 160);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const x = d3
      .scalePoint<string>()
      .domain(fan.map((d) => d.month))
      .range([0, innerW])
      .padding(0.25);

    const maxY = d3.max(fan, (d) => Math.max(d.p95, d.actual ?? 0)) ?? 1000;
    const y = d3.scaleLinear().domain([0, maxY * 1.12]).nice().range([innerH, 0]);

    g.append('g')
      .attr('transform', `translate(0, ${innerH})`)
      .call(d3.axisBottom(x))
      .call((ax) => ax.select('.domain').attr('stroke', 'var(--chart-axis)'))
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

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

    const outerBand = d3
      .area<MonteCarloSummary['monthlyFan'][number]>()
      .x((d) => x(d.month) ?? 0)
      .y0((d) => y(d.p5))
      .y1((d) => y(d.p95))
      .curve(d3.curveMonotoneX);

    const innerBand = d3
      .area<MonteCarloSummary['monthlyFan'][number]>()
      .x((d) => x(d.month) ?? 0)
      .y0((d) => y(d.p25))
      .y1((d) => y(d.p75))
      .curve(d3.curveMonotoneX);

    const medianLine = d3
      .line<MonteCarloSummary['monthlyFan'][number]>()
      .x((d) => x(d.month) ?? 0)
      .y((d) => y(d.p50))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(fan).attr('d', outerBand).attr('fill', 'var(--chart-amber)').attr('fill-opacity', 0.14);
    g.append('path').datum(fan).attr('d', innerBand).attr('fill', 'var(--chart-scarlet)').attr('fill-opacity', 0.2);
    g.append('path')
      .datum(fan)
      .attr('d', medianLine)
      .attr('fill', 'none')
      .attr('stroke', 'var(--chart-scarlet)')
      .attr('stroke-width', 2.25);

    g.selectAll('circle.mc-pt')
      .data(fan)
      .enter()
      .append('circle')
      .attr('cx', (d) => x(d.month) ?? 0)
      .attr('cy', (d) => y(d.p50))
      .attr('r', 4)
      .attr('fill', 'var(--chart-scarlet)')
      .attr('stroke', 'var(--card)')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `Horizon ${d.month}`,
          lines: [
            `P50 Median: $${d.p50.toLocaleString()}`,
            `P25–P75 IQR: $${d.p25.toLocaleString()} – $${d.p75.toLocaleString()}`,
            `P5–P95 90% CI: $${d.p5.toLocaleString()} – $${d.p95.toLocaleString()}`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));
  }, [summary, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Monte Carlo Cost Uncertainty Fan Chart" />
      <div className="flex flex-wrap items-center gap-5 mt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-primary" /> P50 Median Forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-primary/25" /> P25–P75 Interquartile Band
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-amber-500/25" /> P5–P95 Tail Uncertainty Band
        </span>
      </div>
      <ChartTooltip tip={tip} />
    </div>
  );
}

export function MonteCarloLossHistogram({ summary }: { summary: MonteCarloSummary }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useContainerWidth(containerRef, 460);
  const isDark = useIsDarkTheme();
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, title: '', lines: [] as string[] });

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const vals = summary.simulatedTotals;
    if (vals.length === 0) return;

    const height = 240;
    const margin = { top: 22, right: 20, bottom: 36, left: 48 };
    const innerW = Math.max(width - margin.left - margin.right, 140);
    const innerH = height - margin.top - margin.bottom;

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    const minV = d3.min(vals) ?? 0;
    const maxV = d3.max(vals) ?? 1000;
    const x = d3.scaleLinear().domain([minV * 0.95, maxV * 1.03]).nice().range([0, innerW]);

    const bins = d3
      .bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(x.ticks(18))(vals);

    const y = d3
      .scaleLinear()
      .domain([0, (d3.max(bins, (b) => b.length) ?? 1) * 1.15])
      .nice()
      .range([innerH, 0]);

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
      .call(d3.axisLeft(y).ticks(4))
      .call((ax) => ax.select('.domain').remove())
      .call((ax) => ax.selectAll('text').attr('class', 'text-[11px] font-mono fill-muted-foreground'));

    g.selectAll('rect.mc-bin')
      .data(bins)
      .enter()
      .append('rect')
      .attr('x', (d) => x(d.x0 ?? 0) + 1)
      .attr('y', (d) => y(d.length))
      .attr('width', (d) => Math.max(1, x(d.x1 ?? 0) - x(d.x0 ?? 0) - 2))
      .attr('height', (d) => Math.max(0, innerH - y(d.length)))
      .attr('rx', 2)
      .attr('fill', (d) =>
        (d.x0 ?? 0) >= summary.p95AggregateLoss ? 'var(--chart-scarlet)' : 'var(--chart-teal)',
      )
      .attr('fill-opacity', 0.85)
      .on('mousemove', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current);
        setTip({
          visible: true,
          x: mx,
          y: my,
          title: `$${Math.round(d.x0 ?? 0).toLocaleString()} – $${Math.round(d.x1 ?? 0).toLocaleString()}`,
          lines: [
            `Trials: ${d.length.toLocaleString()} / ${vals.length.toLocaleString()}`,
            `Probability: ${((d.length / vals.length) * 100).toFixed(1)}%`,
          ],
        });
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, visible: false })));

    [
      { label: 'P50', val: summary.medianAggregateLoss, color: 'var(--foreground)' },
      { label: 'P95 VaR', val: summary.p95AggregateLoss, color: 'var(--chart-scarlet)' },
    ].forEach((ref, idx) => {
      const px = x(ref.val);
      g.append('line')
        .attr('x1', px)
        .attr('x2', px)
        .attr('y1', 0)
        .attr('y2', innerH)
        .attr('stroke', ref.color)
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', '3,3');

      g.append('text')
        .attr('x', Math.min(px + 4, innerW - 70))
        .attr('y', 11 + idx * 13)
        .attr('class', 'text-[10px] font-mono font-semibold')
        .attr('fill', ref.color)
        .text(`${ref.label}: $${Math.round(ref.val / 1000)}k`);
    });
  }, [summary, width, isDark]);

  return (
    <div ref={containerRef} className="relative">
      <svg ref={svgRef} role="img" aria-label="Monte Carlo Aggregate Loss Distribution" />
      <ChartTooltip tip={tip} />
    </div>
  );
}
