import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import {
  ChartConfiguration,
  ChartData,
  ChartOptions,
  TooltipItem,
} from 'chart.js';

@Component({
  selector: 'app-spi-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective], 
  templateUrl: './spi-chart.component.html',
  styleUrls: ['./spi-chart.component.css'],
})
export class SpiChartComponent {
  @Input() data: { month: string; value: number }[] = [];
  @Input() unit: string = '';

  chartData: ChartConfiguration['data'] = { labels: [], datasets: [] };
  chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(0,0,0,0.08)' } } },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} ${this.unit}` } } }
  };

  ngOnChanges(_: SimpleChanges): void {
    this.chartData = {
      labels: this.data.map(d => d.month),
      datasets: [{
        data: this.data.map(d => d.value),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(14,165,233,0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    };
  }
}
