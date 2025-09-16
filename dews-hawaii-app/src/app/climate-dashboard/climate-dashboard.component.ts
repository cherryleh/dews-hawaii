import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StatBoxComponent } from '../stat-box/stat-box.component';
import { TrendChartComponent } from '../trend-chart/trend-chart.component';

interface Island {
  id: string; name: string; short: string; cx: number; cy: number; r: number; divisions: string[];
}

const ISLANDS: Island[] = [
  { id: 'niihau', name: 'Niʻihau', short: 'Niʻihau', cx: 120, cy: 90, r: 10, divisions: ['West Niʻihau', 'East Niʻihau'] },
  { id: 'kauai', name: 'Kauaʻi', short: 'Kauaʻi', cx: 150, cy: 110, r: 20, divisions: ['North Kauaʻi', 'South Kauaʻi'] },
  { id: 'oahu', name: 'Oʻahu', short: 'Oʻahu', cx: 250, cy: 140, r: 18, divisions: ['Windward Oʻahu', 'Leeward Oʻahu', 'Honolulu'] },
  { id: 'molokai', name: 'Molokaʻi', short: 'Molokaʻi', cx: 320, cy: 155, r: 16, divisions: ['West Molokaʻi', 'East Molokaʻi'] },
  { id: 'lanai', name: 'Lānaʻi', short: 'Lānaʻi', cx: 335, cy: 185, r: 12, divisions: ['Central Lānaʻi'] },
  { id: 'maui', name: 'Maui', short: 'Maui', cx: 355, cy: 165, r: 26, divisions: ['West Maui', 'Central Maui', 'East Maui'] },
  { id: 'kahoolawe', name: 'Kahoʻolawe', short: 'Kahoʻolawe', cx: 355, cy: 205, r: 10, divisions: ['Kahoʻolawe'] },
  { id: 'hawaii', name: 'Hawaiʻi (Island of Hawaiʻi)', short: 'Hawaiʻi', cx: 460, cy: 230, r: 40, divisions: ['Hawaiʻi Mauka', 'Windward Kohala', 'Kaʻu', 'Hilo', 'Leeward Kohala', 'Kona'] },
];

@Component({
  selector: 'app-climate-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, StatBoxComponent, TrendChartComponent],
  templateUrl: './climate-dashboard.component.html',
  styleUrls: ['./climate-dashboard.component.css']
})
export class ClimateDashboardComponent {
  // Theme (CSS vars are set in component CSS)
  islands = ISLANDS;

  trackByIsle = (_: number, isle: { id: string | number }) => isle.id;
  trackByDivision = (_: number, d: string) => d;

  // State
  selectedIsland = signal<Island | null>(null);
  selectedDivision = signal<string | null>(null);
  selectedDataset = signal<'Rainfall' | 'Temperature'>('Rainfall');
  selectedTimescale = signal<number>(1); // 1..12

  unit = computed(() => this.selectedDataset() === 'Rainfall' ? 'in' : '°F');

  // Mock 12-month series, varies by selection
  tsData = computed(() => {
    const now = new Date();
    const seedStr = `${this.selectedIsland()?.id || 'state'}|${this.selectedDivision() || 'state'}|${this.selectedDataset()}`;
    let h = 0; for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) % 1000;
    const phase = (h % 360) * Math.PI / 180;
    const arr: { month: string; value: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = d.toLocaleString('en-US', { month: 'short' });
      const t = (11 - i) / 11; // 0..1 across the year
      const seasonal = Math.sin(t * 2 * Math.PI + phase);
      let value: number;
      if (this.selectedDataset() === 'Rainfall') {
        value = Math.max(0, 2.2 + 1.4 * seasonal + ((h % 37) - 18) / 60);
      } else {
        value = 72 + 5 * seasonal + ((h % 37) - 18) / 10;
      }
      value = Math.round(value * 10) / 10;
      arr.push({ month, value });
    }
    return arr;
  });

  pickIsland(isle: Island) { this.selectedIsland.set(isle); this.selectedDivision.set(null); }
  pickDivision(d: string) { this.selectedDivision.set(d); }
  pickDataset(ds: 'Rainfall' | 'Temperature') { this.selectedDataset.set(ds); }
  setTimescale(m: number) { this.selectedTimescale.set(m); }
  reset() { this.selectedIsland.set(null); this.selectedDivision.set(null); this.selectedDataset.set('Rainfall'); this.selectedTimescale.set(1); }

  email = signal<string>('');

  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));


  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedIsland()?.short || 'Statewide';
    alert(`Subscribed ${this.email} to monthly ${this.selectedDataset()} updates for ${label} at ${this.selectedTimescale()}-month scale.`);
  }
}