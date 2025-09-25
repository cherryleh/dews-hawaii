import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import * as d3 from 'd3';
import * as GeoTIFF from 'geotiff';
import { scaleSequential } from 'd3-scale';
import { extent } from 'd3-array';
import { interpolateViridis } from 'd3-scale-chromatic';
import { ChangeDetectionStrategy, NgZone } from '@angular/core';
import { Pool } from 'geotiff';

import { StatBoxComponent } from '../stat-box/stat-box.component';
import { SpiChartComponent } from '../spi-chart/spi-chart.component';

type Scope = 'divisions' | 'moku' | 'ahupuaa';

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
type Dataset = 'Rainfall' | 'Temperature' | 'SPI';

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

  // at the top of your component
  const DEBUG = true;


  @Component({
    selector: 'app-climate-dashboard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, SpiChartComponent],
    templateUrl: './climate-dashboard.component.html',
    styleUrls: ['./climate-dashboard.component.css']
  })

export class ClimateDashboardComponent {
  constructor(private http: HttpClient, private zone: NgZone) {}
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

  // Default can remain 'Rainfall'
  // State
  dataset = signal<Dataset>('Rainfall');         // one source of truth
  selectedTimescale = signal<number>(6);         // default to 6 to match UI

  rasterUrl = signal<string | null>(null);
  rasterBox = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  nodataValue: number | null = null;

  // Helpers used by template
  selectedDataset() { return this.dataset(); }   // so {{ selectedDataset() }} works
  setTimescale(m: number) {                      // used by the chips
    this.selectedTimescale.set(m);
    this.loadSPIData(m);
  }

  // Actions used by the chips
  pickDataset(d: Dataset) { this.dataset.set(d); }

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

  private islandStubForCounty(county: string): Island | null {
    const members = COUNTY_GROUPS[county];
    if (!members || !members.length) return null;
    const name = members[0]; // use the first island in that county group
    const id = name.toLowerCase().replace(/\s+/g, '-');
    return {
      id,
      name,
      short: name,
      divisions: DIVISIONS[name] || [],
      feature: null,     // not needed for county flow; pickIsland refits with GeoJSON
      key: id,
    };
  }

  private async renderRainTiffToSvg(
    tiffUrl: string,
    projection: any,
    maxOutput = 1024
  ) {
    try {
      if (DEBUG) {
        console.groupCollapsed(`[TIFF→PNG] ${tiffUrl}`);
        console.time('renderRainTiffToSvg');
        const a = document.createElement('a'); a.href = tiffUrl;
        console.log('Resolved URL:', a.href);
      }

      const tiff = await GeoTIFF.fromUrl(tiffUrl);
      const img = await tiff.getImage();

      const width = img.getWidth();
      const height = img.getHeight();
      if (DEBUG) console.log('TIFF size:', { width, height });

      // ----- bbox / georef (with fallback) -----
      let bbox = img.getBoundingBox?.();
      if (!bbox || !bbox.every(Number.isFinite)) {
        const origin = (img as any).getOrigin?.();
        const res = (img as any).getResolution?.();
        if (origin && res) {
          const minX = origin[0], maxY = origin[1];
          const maxX = origin[0] + res[0] * width;
          const minY = origin[1] - res[1] * height;
          bbox = [minX, minY, maxX, maxY];
          if (DEBUG) console.warn('Using origin/resolution fallback bbox:', bbox);
        } else {
          console.error('No usable georeferencing on TIFF.');
          return;
        }
      }
      const [minX, minY, maxX, maxY] = bbox;

      // ----- downsample size -----
      const scale = Math.min(1, maxOutput / Math.max(width, height));
      const readW = Math.max(1, Math.round(width * scale));
      const readH = Math.max(1, Math.round(height * scale));
      if (DEBUG) console.log('Read size:', { readW, readH, scale });

      // ----- read rasters (NEAREST + NoData) -----
      const ndRaw = img.getGDALNoData?.();
      const nodataValue = ndRaw != null ? Number(ndRaw) : null;
      this.nodataValue = nodataValue;
      const EPS = 1e-6;

      const ras = await img.readRasters({
        samples: [0],
        width: readW,
        height: readH,
        interleave: true,
        resampleMethod: 'nearest',
        ...(nodataValue != null ? { fillValue: nodataValue } : {})
      });
      const data = ras as Float32Array | Uint16Array | number[];
      if (DEBUG) {
        console.log('dtype:', Object.prototype.toString.call(data), 'len:', data.length);
        console.log('first samples:', Array.from((data as any).slice(0, 8)));
        console.log('NoData:', nodataValue);
      }

      const isNoData = (v: number) =>
        !Number.isFinite(v) ||
        (nodataValue != null && (v === nodataValue || Math.abs(v - nodataValue) < EPS)) ||
        v < -1e20;

      // ----- domain ignoring NoData -----
      const finiteVals: number[] = [];
      for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        if (!isNoData(v)) finiteVals.push(v);
      }
      if (!finiteVals.length) { console.warn('No finite values (all NoData?)'); return; }

      const [vmin, vmax] = extent(finiteVals) as [number, number];
      const color = scaleSequential(interpolateViridis).domain([vmax, vmin]); // reversed

      // ----- paint to canvas -----
      const canvas = document.createElement('canvas');
      canvas.width = readW; canvas.height = readH;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(readW, readH);

      let j = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        if (isNoData(v)) {
          imgData.data[j++] = 0; imgData.data[j++] = 0; imgData.data[j++] = 0; imgData.data[j++] = 0;
        } else {
          const c = (d3 as any).rgb(color(v));
          imgData.data[j++] = c.r; imgData.data[j++] = c.g; imgData.data[j++] = c.b; imgData.data[j++] = 200;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');
      if (DEBUG) console.log('dataURL len:', dataUrl.length, dataUrl.slice(0, 40) + '…');
      this.rasterUrl.set(dataUrl);

      // ----- project 4 corners → image box -----
      const corners = [
        projection([minX, minY]),
        projection([minX, maxY]),
        projection([maxX, minY]),
        projection([maxX, maxY]),
      ].filter(Boolean) as [number, number][];

      if (!corners.length) { console.error('Projection returned null for all corners.'); return; }

      const xs = corners.map(c => c[0]);
      const ys = corners.map(c => c[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(...xs) - x;
      const h = Math.max(...ys) - y;
      if (!(isFinite(w) && isFinite(h) && w > 0 && h > 0)) {
        console.error('Projected box invalid:', { x, y, w, h, corners }); return;
      }
      this.rasterBox.set({ x, y, w, h });
      if (DEBUG) console.log('Projected box:', { x, y, w, h });

      // inspect the rendered <image>
      setTimeout(() => {
        const imgEl = document.querySelector<SVGImageElement>('svg.map-svg image');
        if (!imgEl) return;
        const href = imgEl.getAttribute('href');
        const hrefXL = imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        const clip = imgEl.getAttribute('clip-path');
        console.log('DOM image attrs:', { href, hrefXL, clip });
        if (href?.startsWith('unsafe:') || hrefXL?.startsWith('unsafe:')) {
          console.error('Angular sanitization is blocking the data URL.');
        }
      }, 0);

      if (DEBUG) { console.timeEnd('renderRainTiffToSvg'); console.groupEnd(); }
    } catch (err) {
      console.error('renderRainTiffToSvg failed:', err);
      this.rasterUrl.set(null);
      this.rasterBox.set(null);
    }
  }



  // Public handler for the chips
  pickCounty(county: string) {
    const stub = this.islandStubForCounty(county);
    if (stub) this.pickIsland(stub);
  }
  
  selectedCounty = computed(() => {
    const isle = this.selectedIsland();
    return isle ? getCountyForIsland(isle.name) : null;
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
      const projection = geoIdentity().reflectY(true).fitSize([560, 320], fc);
      const path = geoPath(projection as any);

      // 🔽 build & set features FIRST so map shows no matter what
      const features = fc.features.map((f: any) => {
        const name = f.properties?.isle || f.properties?.island || f.properties?.name || 'Unknown';
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return <Island>{ id, name, short: name, divisions: DIVISIONS[name] || [], feature: f, key: id };
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

      // 🔽 then kick off raster render without await; never block the map
      if (this.selectedDataset() === 'Rainfall') {
        this.renderRainTiffToSvg('rainfall_2025_08.tif', projection)
          .catch(err => {
            console.error('Raster render failed:', err);
            this.rasterUrl.set(null);
            this.rasterBox.set(null);
          });
      } else {
        this.rasterUrl.set(null);
        this.rasterBox.set(null);
      }
    });
    // Load scoped divisions metadata (if you need it later)
    this.http.get<any>('hawaii_islands_divisions.geojson').subscribe(fc => this.allDivisions = fc);

    this.loadSPIData(this.selectedTimescale()); // start with 6 if you chose 6 above
    
  }


  private loadSPIData(scale: number) {
    // Island-level (always)
    this.http.get(`island_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
        if (this.selectedIsland() && !this.selectedDivision()) {
          this.pickIsland(this.selectedIsland()!);
        }
      });

    // Scope-specific (only if a scope is selected)
    const scope = this.selectedScope();
    if (scope) {
      let file = '';
      let labelKey: 'division' | 'moku' | 'ahupuaa';
      if (scope === 'divisions') { file = `division_spi${scale}.csv`; labelKey = 'division'; }
      else if (scope === 'moku') { file = `moku_spi${scale}.csv`; labelKey = 'moku'; }
      else { file = `ahupuaa_spi${scale}.csv`; labelKey = 'ahupuaa'; }

      this.http.get(file, { responseType: 'text' })
        .subscribe(csv => {
          this.divisionSPI = this.parseCsv(csv, labelKey);
          if (this.selectedDivision()) this.pickDivision(this.selectedDivision()!);
        });
    } else {
      // No scope selected → clear any prior scope data
      this.divisionSPI = [];
      this.selectedDivision.set(null);
    }

    // Statewide (always)
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

  

  // Default: no scope selected
  selectedScope = signal<Scope | null>(null);

  setScope(scope: Scope | null) {
    this.selectedScope.set(scope);

    // If an island/county is already selected, re-render with new scope (or none)
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


  timeRangeLabel(ts: number): string {
    if (ts === 1) return 'Last month';
    if (ts === 6) return 'Last 6 months';
    if (ts === 12) return 'Last year';
    return `${ts}-month`;
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

    const scope = this.selectedScope();
    const groupCanon = new Set(getIslandsInSameCounty(isle.name).map(canonIsland));

    if (!scope) {
      // --- NO SCOPE: county = group of island outlines ---
      this.viewMode.set('islands');

        this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
        const fcCounty = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const name = f.properties?.isle || f.properties?.island || f.properties?.name || '';
            return groupCanon.has(canonIsland(String(name)));
          })
        } as FeatureCollection;

        const projection = geoIdentity().reflectY(true).fitSize([560, 320], fcCounty);
        const path = geoPath(projection as any);

        const features = fcCounty.features.map((f: any) => {
          const name = f.properties?.isle || f.properties?.island || f.properties?.name || 'Island';
          const id = String(name).toLowerCase().replace(/\s+/g, '-');
          return { id, key: id, name, short: name, divisions: [], feature: f } as Island;
        });


        const pathById: Record<string, string> = {};
        const centroidById: Record<string, [number, number]> = {};

        this.islands.set(features);
        this.pathById.set(pathById);
        this.centroidById.set(centroidById);

        if (this.selectedDataset() === 'Rainfall') {
          this.renderRainTiffToSvg('rainfall_2025_08.tif', projection)
            .catch(err => {
              console.error('Raster render failed:', err);
              this.rasterUrl.set(null);
              this.rasterBox.set(null);
            });
        } else {
          this.rasterUrl.set(null);
          this.rasterBox.set(null);
        }

        for (const d of features) {
          pathById[d.id] = path(d.feature)!;
          centroidById[d.id] = path.centroid(d.feature) as [number, number];
        }
        this.islands.set(features);
        this.pathById.set(pathById);
        this.centroidById.set(centroidById);
      });

    } else {
      // --- SCOPE CHOSEN: render scoped polygons (divisions/moku/ahupuaʻa) ---
      this.viewMode.set('divisions');

      const file = scope === 'moku'
        ? 'moku.geojson'
        : scope === 'ahupuaa'
          ? 'ahupuaa.geojson'
          : 'hawaii_islands_divisions.geojson';

      this.http.get<any>(file).subscribe((fc: any) => {
        const fcCounty = {
          type: 'FeatureCollection',
          features: fc.features.filter((f: any) => {
            const p = f.properties || {};
            const featureIslandRaw = this.getProp(p, ['mokupuni','island','Island','ISLAND','isle','Isle']);
            const featureIslandCanon = canonIsland(String(featureIslandRaw || ''));
            return groupCanon.has(featureIslandCanon);
          })
        } as FeatureCollection;

        const projection = geoIdentity().reflectY(true).fitSize([560, 320], fcCounty);
        const path = geoPath(projection as any);

        const features = fcCounty.features.map((f: any) => {
          const p = f.properties || {};
          const name =
            scope === 'ahupuaa'
              ? (this.getProp(p, ['ahupuaa','Ahupuaʻa','Ahupuaa','AHUPUAA','AhuPuaa','AHUPUAA_N']) || 'Ahupuaʻa')
              : scope === 'moku'
                ? (this.getProp(p, ['moku','Moku','MOKU']) || 'Moku')
                : (this.getProp(p, ['division','Division','name','NAME']) || 'Division');

          const islandRaw = this.getProp(p, ['mokupuni','island','Island','ISLAND','isle','Isle']) || isle.name;
          const islandCanon = canonIsland(String(islandRaw));
          const key = `${islandCanon}::${name}`;
          const id  = `${islandCanon}-${name}`.toLowerCase().replace(/\s+/g, '-');
          return { id, key, name, short: name, island: islandCanon, divisions: [], feature: f } as Island;
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

    const islandData = this.islandSPI
      .filter((r: any) => r.island.toLowerCase() === isle.name.toLowerCase())
      .map((r: any) => ({ month: r.month, value: r.value }));
    this.tsData.set(islandData);
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



  email = signal<string>('');

  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));


  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedIsland()?.short || 'Statewide';
    alert(`Subscribed ${this.email()} to monthly ${this.selectedDataset()} updates for ${label} at ${this.selectedTimescale()}-month scale.`);
  }

  chartFullscreen = signal(false);

  toggleChartFullscreen() {
    this.chartFullscreen.set(!this.chartFullscreen());
  }


}