import { Component, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData, ChartOptions } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

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
          backgroundColor: 'rgba(37, 99, 235, 0.2)', // optional point hover fill
          tension: 0,        // smooth line
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
