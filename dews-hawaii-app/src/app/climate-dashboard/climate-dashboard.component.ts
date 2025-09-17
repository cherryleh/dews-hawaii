import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import * as d3 from 'd3';


import { StatBoxComponent } from '../stat-box/stat-box.component';
import { SpiChartComponent } from '../spi-chart/spi-chart.component';

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
    imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, SpiChartComponent],
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
  statewideSPI: any[] = [];
  islandSPI: any[] = [];
  divisionSPI: any[] = [];

  ngOnInit() {
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity()
        .reflectY(true)         // flip Y so north is up
        .fitSize([560, 320], fc);

      const path = geoPath(projection as any);

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

    this.http.get('island_spi_timeseries.csv', { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
      });

    // load division SPI
    this.http.get('division_spi_timeseries.csv', { responseType: 'text' })
      .subscribe(csv => {
        this.divisionSPI = this.parseCsv(csv, 'division');
      });

    this.http.get('statewide_spi_timeseries.csv', { responseType: 'text' })
    .subscribe(csv => {
      this.statewideSPI = this.parseCsv(csv, 'state');

      // initialize chart with statewide data
      const stateData = this.statewideSPI
        .filter(r => r.state.toLowerCase() === 'statewide')
        .map(r => ({ month: r.month, value: r.value }));

      this.tsData.set(stateData);
    });

  }

  private parseCsv(csvData: string, labelKey: 'state' | 'island' | 'division') {
    const rows = csvData.split('\n').map(r => r.split(','));
    const headers = rows[0];
    const data: any[] = [];

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue; // skip blank rows
      const label = rows[i][0].trim();
      for (let j = 1; j < headers.length; j++) {
        data.push({
          [labelKey]: label,
          month: headers[j],
          value: +rows[i][j]
        });
      }
    }
    return data;
  }


  tsData = signal<{ month: string; value: number }[]>([]);


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

    const islandData = this.islandSPI
    .filter((r: any) => r.island.toLowerCase() === isle.name.toLowerCase())
    .map((r: any) => ({ month: r.month, value: r.value }));

    this.tsData.set(islandData);
  }

  pickDivision(d: string) {
    this.selectedDivision.set(d);

    const divisionData = this.divisionSPI
      .filter((r: any) => r.division === d)
      .map((r: any) => ({ month: r.month, value: r.value }));

    this.tsData.set(divisionData);
  }

  reset() {
    this.selectedIsland.set(null);
    this.selectedDivision.set(null);
    this.viewMode.set('islands');  

    // reload map
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
    const stateData = this.statewideSPI
      .filter(r => r.state.toLowerCase() === 'statewide')
      .map(r => ({ month: r.month, value: r.value }));
    this.tsData.set(stateData);
  }





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