import { Component, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData, ChartOptions, Chart } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

// 🔴 Register plugin globally (outside the class)
Chart.register({
  id: 'shadePlugin',
  beforeDraw: (chart: any) => {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;

    const yBottom = scales['y'].getPixelForValue(-3);
    const yTop = scales['y'].getPixelForValue(-1);

    ctx.save();
    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; // light red shading
    ctx.fillRect(chartArea.left, yTop, chartArea.right - chartArea.left, yBottom - yTop);
    ctx.restore();
  }
});

@Component({
  selector: 'app-spi-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective], 
  templateUrl: './spi-chart.component.html',
  styleUrls: ['./spi-chart.component.css']
})
export class SpiChartComponent {
  @Input() data: { month: string; value: number }[] = [];
  @Input() unit: string = '';

  @ViewChild(BaseChartDirective) chart?: BaseChartDirective;

  get chartData(): ChartData<'line'> {
    return {
      labels: this.data.map(d => d.month),
      datasets: [
        {
          label: 'SPI',
          data: this.data.map(d => d.value),
          borderColor: 'rgba(37, 99, 235, 1)',  // blue line
          backgroundColor: 'rgba(37, 99, 235, 0.2)',
          tension: 0,
          fill: false,         
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    };
  }

  chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: true },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      y: {
        title: { display: true, text: 'SPI' },
        min: -3,
        max: 3,
        ticks: { stepSize: 1 }
      },
      x: {
        title: { display: true, text: 'Month' }
      }
    }
  };
}
