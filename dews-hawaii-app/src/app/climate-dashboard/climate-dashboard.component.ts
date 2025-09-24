import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import * as d3 from 'd3';


import { StatBoxComponent } from '../stat-box/stat-box.component';
import { SpiChartComponent } from '../spi-chart/spi-chart.component';
// Island → County (only need what we use)
const COUNTY_BY_ISLAND: Record<string, string> = {
  'Kauaʻi': 'Kauaʻi',
  'Oʻahu': 'Honolulu',
  'Molokaʻi': 'Maui',
  'Lānaʻi': 'Maui',
  'Maui': 'Maui',
  'Kahoʻolawe': 'Maui',
  'Hawaiʻi': 'Hawaiʻi'
};

// County → list of islands
const COUNTY_GROUPS: Record<string, string[]> = {
  'Kauaʻi': ['Kauaʻi'],
  'Honolulu': ['Oʻahu'],
  'Maui': ['Maui', 'Molokaʻi', 'Lānaʻi', 'Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi']
};

function getCountyForIsland(islandName: string): string {
  return COUNTY_BY_ISLAND[islandName] ?? islandName;
}

function getIslandsInSameCounty(islandName: string): string[] {
  const c = getCountyForIsland(islandName);
  return COUNTY_GROUPS[c] ?? [islandName];
}

interface Island {
  id: string;
  name: string;
  short: string;
  divisions: string[];
  feature: any;
  key: string;        // <-- required now
  island?: string;
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

  function canonIsland(name: string): string {
    if (!name) return '';
    return name
      .normalize('NFD')                 // split diacritics
      .replace(/\p{Diacritic}/gu, '')   // strip macrons
      .replace(/['’ʻ`]/g, '')           // strip okina/apostrophes
      .toLowerCase()
      .trim();
  }

  const CANON_TO_DISPLAY: Record<string, string> = {
    kauai: 'Kauaʻi',
    niihau: 'Niʻihau',
    oahu: 'Oʻahu',
    molokai: 'Molokaʻi',
    lanai: 'Lānaʻi',
    maui: 'Maui',
    kahoolawe: 'Kahoʻolawe',
    hawaii: 'Hawaiʻi',
  };
  function prettyIsland(canon?: string) {
    return canon ? (CANON_TO_DISPLAY[canon] ?? canon) : '';
  }



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
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);

  // State
  selectedIsland = signal<Island | null>(null);
  selectedDivision = signal<string | null>(null);
  selectedDataset = signal<'Rainfall' | 'Temperature' | 'NDVI'>('Rainfall');
  selectedTimescale = signal<number>(1); // 1..12
  viewMode = signal<'islands' | 'divisions'>('islands');

  unit = computed(() => this.selectedDataset() === 'Rainfall' ? 'in' : '°F');
  allDivisions: any;
  statewideSPI: any[] = [];
  islandSPI: any[] = [];
  divisionSPI: any[] = [];

  selectedDivisionName = computed(() => {
    const sel = this.selectedDivision();
    if (!sel) return null;
    // handle either "island::Name" or just "Name"
    const parts = sel.split('::');
    return parts.length === 2 ? parts[1] : sel;
  });

  
  countyLabel = computed(() => {
    const isle = this.selectedIsland();
    if (!isle) return null;
    const county = getCountyForIsland(isle.name);
    const members = getIslandsInSameCounty(isle.name);
    // Only show "County" if it’s a multi-island county
    return members.length > 1 ? `${county} County` : isle.short;
  });


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
          feature: f,
          key: id
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

    this.loadSPIData(1);

  }

  private loadSPIData(scale: number) {
    // Island-level data (always the same)
    this.http.get(`island_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
        if (this.selectedIsland() && !this.selectedDivision()) {
          this.pickIsland(this.selectedIsland()!);
        }
      });

    // Scope-specific data
    const scope = this.selectedScope();
    let file = '';
    let labelKey: 'division' | 'moku' | 'ahupuaa';

    if (scope === 'divisions') {
      file = `division_spi${scale}.csv`;
      labelKey = 'division';
    } else if (scope === 'moku') {
      file = `moku_spi${scale}.csv`;
      labelKey = 'moku';
    } else {
      file = `ahupuaa_spi${scale}.csv`; // placeholder
      labelKey = 'ahupuaa';
    }

    this.http.get(file, { responseType: 'text' })
      .subscribe(csv => {
        this.divisionSPI = this.parseCsv(csv, labelKey);
        if (this.selectedDivision()) {
          this.pickDivision(this.selectedDivision()!);
        }
      });

    // Statewide always the same
    this.http.get(`statewide_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.statewideSPI = this.parseCsv(csv, 'state');
        if (!this.selectedIsland() && !this.selectedDivision()) {
          const stateData = this.statewideSPI
            .filter(r => r.state.toLowerCase() === 'statewide')
            .map(r => ({ month: r.month, value: r.value }));
          this.tsData.set(stateData);
        }
      });
  }

  onHover(feature: any, event: MouseEvent) {
    if (this.selectedScope() === 'ahupuaa') {
      const svg = (event.target as SVGPathElement).ownerSVGElement!;
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const screenCTM = svg.getScreenCTM();
      if (screenCTM) {
        const svgP = pt.matrixTransform(screenCTM.inverse());
        this.hoveredLabel.set({ name: feature.name, x: svgP.x, y: svgP.y });
      }
    }
  }

  selectedScope = signal<'divisions' | 'moku' | 'ahupuaa'>('divisions');

  setScope(scope: string) {
    this.selectedScope.set(scope as any);

    // If an island is already selected, reload it in the new scope
    if (this.selectedIsland()) {
      this.pickIsland(this.selectedIsland()!);
    }
  }

  private parseCsv(
    csvData: string,
    labelKey: 'state' | 'island' | 'division' | 'moku' | 'ahupuaa'
  ) {
    const rows = csvData.split('\n').map(r => r.split(','));
    const headers = rows[0];
    const data: any[] = [];

    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
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


  timeRangeLabel(value: number): string {
    switch (value) {
      case 1: return 'Short Term';
      case 6: return 'Medium Term';
      case 12: return 'Long Term';
      default: return `${value}-month`; // fallback
    }
  }

  tsData = signal<{ month: string; value: number }[]>([]);
  // Return the first non-empty property found
  private getProp(o: any, keys: string[]) {
    for (const k of keys) {
      const v = o?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  }

  pickIsland(isle: Island) {
    this.selectedIsland.set(isle);
    this.selectedDivision.set(null);
    this.viewMode.set('divisions');

    // Determine the group (e.g., Maui County group)
    const groupIslands = new Set(getIslandsInSameCounty(isle.name));

    // choose file depending on scope
    const file = this.selectedScope() === 'moku'
      ? 'moku.geojson'
      : this.selectedScope() === 'ahupuaa'
        ? 'ahupuaa.geojson'
        : 'hawaii_islands_divisions.geojson';

    const isMoku = this.selectedScope() === 'moku';
    const isAhupuaa = this.selectedScope() === 'ahupuaa';

    const groupCanon = new Set(getIslandsInSameCounty(isle.name).map(canonIsland));

      this.http.get<any>(file).subscribe((fc: any) => {
        const fcCounty = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const p = f.properties || {};
            const featureIslandRaw = this.getProp(p, ['mokupuni', 'island', 'Island', 'ISLAND', 'isle', 'Isle']);
            const featureIslandCanon = canonIsland(String(featureIslandRaw || ''));
            return groupCanon.has(featureIslandCanon);
          })
        } as FeatureCollection;

      // Fit projection to the combined county features
      const projection = geoIdentity()
        .reflectY(true)
        .fitSize([560, 320], fcCounty);

      const path = geoPath(projection as any);

      const features = fcCounty.features.map((f: any) => {
        const p = f.properties || {};
        const isAhupuaa = this.selectedScope() === 'ahupuaa';
        const isMoku = this.selectedScope() === 'moku';

        const name = isAhupuaa
          ? (this.getProp(p, ['ahupuaa', 'Ahupuaʻa', 'Ahupuaa', 'AHUPUAA', 'AhuPuaa', 'AHUPUAA_N']) || 'Ahupuaʻa')
          : isMoku
            ? (this.getProp(p, ['moku', 'Moku', 'MOKU']) || 'Moku')
            : (this.getProp(p, ['division', 'Division', 'name', 'NAME']) || 'Division');

        const islandRaw = this.getProp(p, ['mokupuni', 'island', 'Island', 'ISLAND', 'isle', 'Isle']) || isle.name;
        const islandCanon = canonIsland(String(islandRaw));

        // Unique key for selection/highlight (prevents duplicate-name collisions)
        const key = `${islandCanon}::${name}`;

        // ID for pathById lookup (safe for attrs)
        const id = `${islandCanon}-${name}`.toLowerCase().replace(/\s+/g, '-');

        return { id, key, name, short: name, island: islandCanon, divisions: [], feature: f };
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

    // ---- Trend: average island SPI across the whole county group ----
    // this.islandSPI is shaped like: { island, month, value }
    const byMonth: Record<string, number[]> = {};
    for (const r of this.islandSPI) {
      if (groupIslands.has((r.island || '').trim())) {
        if (!byMonth[r.month]) byMonth[r.month] = [];
        byMonth[r.month].push(+r.value);
      }
    }
    const averaged = Object.keys(byMonth).sort().map(m => ({
      month: m,
      value: byMonth[m].reduce((a, b) => a + b, 0) / byMonth[m].length
    }));

    // Fallback: if we somehow didn't match anything, just show the clicked island
    this.tsData.set(averaged.length ? averaged : this.islandSPI
      .filter((r: any) => r.island.toLowerCase() === isle.name.toLowerCase())
      .map((r: any) => ({ month: r.month, value: r.value }))
    );
  }


  pickDivision(d: string) {
    this.selectedDivision.set(d);

    const scope = this.selectedScope();
    let key: 'division' | 'moku' | 'ahupuaa' = 'division';
    if (scope === 'moku') key = 'moku';
    else if (scope === 'ahupuaa') key = 'ahupuaa';

    const data = this.divisionSPI
      .filter((r: any) => r[key] === d)
      .map((r: any) => ({ month: r.month, value: r.value }));

    this.tsData.set(data);
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
        return { id, name, short: name, divisions: [], feature: f, key: id } as Island;
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
  setTimescale(m: number) {
    this.selectedTimescale.set(m);
    this.loadSPIData(m);
  }



  email = signal<string>('');

  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));


  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedIsland()?.short || 'Statewide';
    alert(`Subscribed ${this.email} to monthly ${this.selectedDataset()} updates for ${label} at ${this.selectedTimescale()}-month scale.`);
  }
}