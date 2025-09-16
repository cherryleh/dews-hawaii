import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';



import { StatBoxComponent } from '../stat-box/stat-box.component';
import { TrendChartComponent } from '../trend-chart/trend-chart.component';

interface Island {
  id: string;
  name: string;
  short: string;
  divisions: string[];
  feature: any;
}

const DIVISIONS: Record<string, string[]> = {
  'Kauaʻi': ['North Kauaʻi', 'South Kauaʻi'],
  'Oʻahu': ['Windward Oʻahu', 'Leeward Oʻahu', 'Honolulu'],
  'Molokaʻi': ['West Molokaʻi', 'East Molokaʻi'],
  'Lānaʻi': ['Central Lānaʻi'],
  'Maui': ['West Maui', 'Central Maui', 'East Maui'],
  'Kahoʻolawe': ['Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi Mauka', 'Windward Kohala', 'Kaʻu', 'Hilo', 'Leeward Kohala', 'Kona'],
};

  @Component({
    selector: 'app-climate-dashboard',
    standalone: true,
    imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, TrendChartComponent],
    templateUrl: './climate-dashboard.component.html',
    styleUrls: ['./climate-dashboard.component.css']
  })

export class ClimateDashboardComponent {
  constructor(private http: HttpClient) {}
  islands = signal<Island[]>([]);
  pathById = signal<Record<string, string>>({});
  centroidById = signal<Record<string, [number, number]>>({});
  trackByIsle = (_: number, isle: { id: string | number }) => isle.id;
  trackByDivision = (_: number, d: string) => d;
  hoveredFeature = signal<string | null>(null);

  // State
  selectedIsland = signal<Island | null>(null);
  selectedDivision = signal<string | null>(null);
  selectedDataset = signal<'Rainfall' | 'Temperature'>('Rainfall');
  selectedTimescale = signal<number>(1); // 1..12
  viewMode = signal<'islands' | 'divisions'>('islands');

  unit = computed(() => this.selectedDataset() === 'Rainfall' ? 'in' : '°F');
  allDivisions: any;
  ngOnInit() {
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity()
        .reflectY(true)         // flip Y so north is up
        .fitSize([560, 320], fc);

      const path = geoPath(projection as any);

      console.log(fc.features[0].properties);


      const features = fc.features.map((f: any) => {
        const name = f.properties?.isle 
                   || f.properties?.island 
                   || f.properties?.name 
                   || 'Unknown';

        const id = name.toLowerCase().replace(/\s+/g, '-');
        return <Island>{
          id,
          name,
          short: name,
          divisions: DIVISIONS[name] || [],
          feature: f
        };
        this.http.get<any>('hawaii_islands_divisions.geojson').subscribe(fc => this.allDivisions = fc);
      });


      const pathById: Record<string, string> = {};
      const centroidById: Record<string, [number, number]> = {};
      for (const is of features) {
        pathById[is.id] = path(is.feature)!;
        centroidById[is.id] = path.centroid(is.feature) as [number, number];
      }

      this.islands.set(features);
      this.pathById.set(pathById);
      this.centroidById.set(centroidById);
    });
  }


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

  pickIsland(isle: Island) {
    this.selectedIsland.set(isle);
    this.selectedDivision.set(null);
    this.viewMode.set('divisions'); 

    this.http.get<any>('hawaii_islands_divisions.geojson').subscribe((fc: any) => {
      const fcIsland = {
        type: 'FeatureCollection',
        features: fc.features.filter((f: any) => f.properties?.isle === isle.name)
      } as FeatureCollection;

      const projection = geoIdentity()
        .reflectY(true)
        .fitSize([560, 320], fcIsland);

      const path = geoPath(projection as any);

      const features = fcIsland.features.map((f: any) => {
        const name = f.properties?.division || f.properties?.name || 'Division';
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return { id, name, short: name, divisions: [], feature: f };
      });

      const pathById: Record<string, string> = {};
      const centroidById: Record<string, [number, number]> = {};
      for (const d of features) {
        pathById[d.id] = path(d.feature)!;
        centroidById[d.id] = path.centroid(d.feature) as [number, number];
      }

      this.islands.set(features);
      this.pathById.set(pathById);
      this.centroidById.set(centroidById);
    });
  }

  reset() {
    this.selectedIsland.set(null);
    this.selectedDivision.set(null);
    this.viewMode.set('islands');  

    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity()
        .reflectY(true)
        .fitSize([560, 320], fc);

      const path = geoPath(projection as any);

      const features = fc.features.map((f: any) => {
        const name = f.properties?.isle || 'Island';
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return { id, name, short: name, divisions: [], feature: f };
      });

      const pathById: Record<string, string> = {};
      const centroidById: Record<string, [number, number]> = {};
      for (const is of features) {
        pathById[is.id] = path(is.feature)!;
        centroidById[is.id] = path.centroid(is.feature) as [number, number];
      }

      this.islands.set(features);
      this.pathById.set(pathById);
      this.centroidById.set(centroidById);
    });
  }



  pickDivision(d: string) { this.selectedDivision.set(d); }
  pickDataset(ds: 'Rainfall' | 'Temperature') { this.selectedDataset.set(ds); }
  setTimescale(m: number) { this.selectedTimescale.set(m); }

  email = signal<string>('');

  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));


  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedIsland()?.short || 'Statewide';
    alert(`Subscribed ${this.email} to monthly ${this.selectedDataset()} updates for ${label} at ${this.selectedTimescale()}-month scale.`);
  }
}