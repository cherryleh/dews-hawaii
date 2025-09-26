import { Component, computed, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { geoIdentity, geoPath } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import * as d3 from 'd3';
import { take } from 'rxjs/operators';

import { StatBoxComponent } from '../stat-box/stat-box.component';
import { SpiChartComponent } from '../spi-chart/spi-chart.component';

import * as GeoTIFF from 'geotiff';
import { Pool } from 'geotiff';
import { interpolateViridis, interpolateRdBu } from 'd3-scale-chromatic';
import { NgZone } from '@angular/core';

type Scope = 'divisions' | 'moku' | 'ahupuaa';
type Dataset = 'Rainfall' | 'Temperature' | 'Drought';

interface Island {
  id: string;
  name: string;
  short: string;
  divisions: string[];
  feature: any;
  key: string;
  island?: string;
}

// Island → County (only what we need)
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

const DIVISIONS: Record<string, string[]> = {
  'Kauaʻi': ['North Kauaʻi', 'South Kauaʻi'],
  'Oʻahu': ['Windward Oʻahu', 'Leeward Oʻahu', 'Honolulu'],
  'Molokaʻi': ['West Molokaʻi', 'East Molokaʻi'],
  'Lānaʻi': ['Central Lānaʻi'],
  'Maui': ['West Maui', 'Central Maui', 'East Maui'],
  'Kahoʻolawe': ['Kahoʻolawe'],
  'Hawaiʻi': ['Hawaiʻi Mauka', 'Windward Kohala', 'Kaʻu', 'Hilo', 'Leeward Kohala', 'Kona'],
};

function getCountyForIsland(islandName: string): string {
  return COUNTY_BY_ISLAND[islandName] ?? islandName;
}
function getIslandsInSameCounty(islandName: string): string[] {
  const c = getCountyForIsland(islandName);
  return COUNTY_GROUPS[c] ?? [islandName];
}
function canonIsland(name: string): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’ʻ`]/g, '')
    .toLowerCase()
    .trim();
}



@Component({
  selector: 'app-climate-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule, StatBoxComponent, SpiChartComponent],
  templateUrl: './climate-dashboard.component.html',
  styleUrls: ['./climate-dashboard.component.css']
})
export class ClimateDashboardComponent implements OnDestroy {
  constructor(private http: HttpClient, private ngZone: NgZone) {}

  // ===== Map data/state =====
  islands = signal<Island[]>([]);
  pathById = signal<Record<string, string>>({});
  centroidById = signal<Record<string, [number, number]>>({});
  trackByIsle = (_: number, isle: { id: string | number }) => isle.id;
  trackByDivision = (_: number, d: string) => d;
  hoveredFeature = signal<string | null>(null);
  hoveredLabel = signal<{ name: string; x: number; y: number } | null>(null);

  selectedIsland = signal<Island | null>(null);
  selectedDivision = signal<string | null>(null);
  viewMode = signal<'islands' | 'divisions'>('islands');

  // ===== Dataset/time =====
  dataset = signal<Dataset>('Rainfall');
  selectedTimescale = signal<number>(6);
  selectedDataset() { return this.dataset(); }
  pickDataset(d: Dataset) {
    this.dataset.set(d);
    this.loadRasterOnce(d);
  }

  colorbarMin = 0;
  colorbarMax = 1;
  colorbarMid: number | null = null;


  setTimescale(m: number) { this.selectedTimescale.set(m); this.loadSPIData(m); }
  unit = computed(() => {
    if (this.selectedDataset() === 'Rainfall') return 'in';
    if (this.selectedDataset() === 'Temperature') return '°F';
    if (this.selectedDataset() === 'Drought') return 'SPI';
    return '';
  });


  // ===== SPI data buckets =====
  allDivisions: any;
  statewideSPI: any[] = [];
  islandSPI: any[] = [];
  divisionSPI: any[] = [];

  // ===== Scope selection =====
  selectedScope = signal<Scope | null>(null);
  setScope(scope: Scope | null) {
    this.selectedScope.set(scope);
    if (this.selectedIsland()) this.pickIsland(this.selectedIsland()!); // rerender with new scope
  }
  selectedDivisionName = computed(() => {
    const sel = this.selectedDivision();
    if (!sel) return null;
    const parts = sel.split('::');
    return parts.length === 2 ? parts[1] : sel;
  });

  // ===== County helpers (UI chips) =====
  selectedCounty = computed(() => {
    const isle = this.selectedIsland();
    return isle ? getCountyForIsland(isle.name) : null;
  });
  countyLabel = computed(() => {
    const isle = this.selectedIsland();
    if (!isle) return null;
    const county = getCountyForIsland(isle.name);
    const members = getIslandsInSameCounty(isle.name);
    return members.length > 1 ? `${county} County` : isle.short;
  });
  private islandStubForCounty(county: string): Island | null {
    const members = COUNTY_GROUPS[county];
    if (!members || !members.length) return null;
    const name = members[0];
    const id = name.toLowerCase().replace(/\s+/g, '-');
    return { id, name, short: name, divisions: DIVISIONS[name] || [], feature: null, key: id };
  }

  pickCounty(county: string) {
    // Clear any active division and scope when a county is chosen
    this.selectedDivision.set(null);
    this.selectedScope.set(null);
    this.viewMode.set('islands');

    const stub = this.islandStubForCounty(county);
    if (stub) {
      this.pickIsland(stub);
    }
  }



  // ===== Chart data (sidebar) =====
  tsData = signal<{ month: string; value: number }[]>([]);
  timeRangeLabel(ts: number): string {
    if (ts === 1) return 'Last month';
    if (ts === 6) return 'Last 6 months';
    if (ts === 12) return 'Last 12 months';
    return `${ts}-month`;
  }

  // ===== Email form =====
  email = signal<string>('');
  private emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  isEmailValid = computed(() => this.emailRegex.test(this.email().trim()));
  subscribe() {
    if (!this.isEmailValid()) return;
    const label = this.selectedDivision() || this.selectedIsland()?.short || 'Statewide';
    alert(`Subscribed ${this.email()} to monthly ${this.selectedDataset()} updates for ${label} at ${this.selectedTimescale()}-month scale.`);
  }

  chartFullscreen = signal(false);
  toggleChartFullscreen() { this.chartFullscreen.set(!this.chartFullscreen()); }

  // ===== Raster (GeoTIFF) =====
  rasterHref = signal<string | null>(null); // Object URL to a PNG/WEBP
  rasterRect = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  private rasterBBox: [number, number, number, number] | null = null; // [minX, minY, maxX, maxY]
  private project: ((p: [number, number]) => [number, number]) | null = null;

  private tiffPool = new Pool(Math.min(4, (navigator.hardwareConcurrency || 4))); // worker pool
  private rasterScaleFactor = 1.5; // 1 = fastest; 1.5–2 = sharper
  private objectUrl: string | null = null; // for cleanup

  // Project bbox → SVG coords; computes <image> x/y/width/height
  private updateRasterRect() {
    if (!this.project || !this.rasterBBox) return;
    const [minX, minY, maxX, maxY] = this.rasterBBox;
    const pTL = this.project([minX, maxY]); // top-left
    const pBR = this.project([maxX, minY]); // bottom-right
    const x = Math.min(pTL[0], pBR[0]);
    const y = Math.min(pTL[1], pBR[1]);
    const width = Math.abs(pBR[0] - pTL[0]);
    const height = Math.abs(pBR[1] - pTL[1]);
    this.rasterRect.set({ x, y, width, height });
  }

  private colorScale: d3.ScaleSequential<string> | d3.ScaleDiverging<string> | null = null;


  // Read & colorize TIFF once; reuse bitmap as projection changes
  private async loadRasterOnce(dataset: Dataset) {
      try {
        let file = '';
        if (dataset === 'Rainfall') file = 'tifs/rainfall_2025_08.tif';
        else if (dataset === 'Temperature') file = 'tifs/tmean_2025_08.tif';
        else if (dataset === 'Drought') file = 'tifs/spi1_2025_08.tif';

        const tiff = await GeoTIFF.fromUrl(file);
        const image = await tiff.getImage();
        this.rasterBBox = image.getBoundingBox() as [number, number, number, number];

      // Downsample target resolution based on SVG (560×320)
      const baseW = 560;
      const targetW = Math.round(baseW * this.rasterScaleFactor);
      const srcW = image.getWidth();
      const srcH = image.getHeight();
      const targetH = Math.max(1, Math.round(targetW * (srcH / srcW)));

      // Read first band with worker pool
      const band = await image.readRasters({
        samples: [0],
        width: targetW,
        height: targetH,
        interleave: true,
        resampleMethod: 'nearest',
        pool: this.tiffPool
      }) as Float32Array | Uint16Array | Uint8Array;

      // Robust NoData
      const nodata = this.getNoDataValue(image);
      const isNoData = (v: number) =>
        (nodata !== undefined && v === nodata) ||
        !Number.isFinite(v) ||
        Math.abs(v) > 1e20;

      // Auto-stretch min/max ignoring NoData
      let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < band.length; i++) {
        const v = Number(band[i]);
        if (isNoData(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }

      if (dataset === 'Drought') {
        min = -3;
        max = 3;
      }
      

      if (dataset === 'Rainfall') {
        // Viridis reversed (high = dark purple, low = yellow)
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([max, min]);
      } else if (dataset === 'Temperature') {
        // Regular Viridis (low = purple, high = yellow)
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([min, max]);
      } else if (dataset === 'Drought') {
        // Blue → White → Red, centered at 0
        const absMax = Math.max(Math.abs(min), Math.abs(max));
        this.colorScale = d3.scaleDiverging(interpolateRdBu).domain([-absMax, 0, absMax]);
      } else {
        // Fallback
        this.colorScale = d3.scaleSequential(interpolateViridis).domain([min, max]);
      }

      // Paint to canvas → Blob URL
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.createImageData(targetW, targetH);

      for (let i = 0; i < band.length; i++) {
        const v = Number(band[i]);
        const idx = i * 4;
        if (isNoData(v)) { imgData.data[idx + 3] = 0; continue; }
        const c = d3.rgb(this.colorScale(v));
        imgData.data[idx + 0] = c.r;
        imgData.data[idx + 1] = c.g;
        imgData.data[idx + 2] = c.b;
        imgData.data[idx + 3] = 220; // alpha
      }
      ctx.putImageData(imgData, 0, 0);

      const blob: Blob = await new Promise(resolve => {
        // Try webp; fall back to png if needed
        canvas.toBlob(b => {
          if (b) return resolve(b);
          canvas.toBlob(b2 => resolve(b2 as Blob), 'image/png');
        }, 'image/webp', 0.9);
      });

      this.colorbarMin = min;
      this.colorbarMax = max;
      this.colorbarMid = dataset === 'Drought' ? 0 : (min + max) / 2;
      this.drawColorbar(dataset);


      // Cleanup previous URL if any
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = URL.createObjectURL(blob);
      this.rasterHref.set(this.objectUrl);
      this.updateRasterRect();
    } catch (err) {
      console.error(`Failed to load raster for ${dataset}`, err);
    }

    this.drawColorbar(dataset);


  }

  private getNoDataValue(image: any): number | undefined {
    const candidates = [
      image?.fileDirectory?.GDAL_NODATA,
      image?.fileDirectory?.NoData,
      image?.getGDALNoData?.()
    ];
    for (const tag of candidates) {
      if (tag != null) {
        const n = Number(tag);
        if (Number.isFinite(n)) return n;
      }
    }
    return undefined;
  }

  // ===== Lifecycle =====
  ngOnInit(): void {
    // Base islands
    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitSize([560, 320], fc);
      const path = geoPath(projection as any);

      // keep projection for raster placement
      this.project = (projection as any);

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

      // initial raster placement; raster loads lazily when dataset === 'Rainfall'
      this.updateRasterRect();
      if (this.selectedDataset() === 'Rainfall') this.loadRasterOnce('Rainfall');

    });

    // Divisions metadata (optional)
    this.http.get<any>('hawaii_islands_divisions.geojson').subscribe(fc => this.allDivisions = fc);

    // Initial SPI load (6-month default)
    this.loadSPIData(this.selectedTimescale());
  }

  private drawColorbar(dataset: Dataset) {
    requestAnimationFrame(() => {
      const canvas = document.getElementById('colorbarCanvas') as HTMLCanvasElement | null;
      if (!canvas || !this.colorScale) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      const steps = 50;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const val = this.colorbarMin + t * (this.colorbarMax - this.colorbarMin);
        grad.addColorStop(t, this.colorScale(val));
      }

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
  }


  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    // Pool will auto-end with page lifecycle; no explicit destroy needed
  }

  // ===== Helpers =====
  private getProp(o: any, keys: string[]) {
    for (const k of keys) {
      const v = o?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  }

  private parseCsv(csvData: string, labelKey: 'state' | 'island' | 'division' | 'moku' | 'ahupuaa') {
    const rows = csvData.split('\n').map(r => r.split(','));
    const headers = rows[0];
    const data: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const label = rows[i][0].trim();
      for (let j = 1; j < headers.length; j++) {
        data.push({ [labelKey]: label, month: headers[j], value: +rows[i][j] });
      }
    }
    return data;
  }

  private loadSPIData(scale: number) {
    // Island-level (always)
    this.http.get(`island_spi${scale}.csv`, { responseType: 'text' })
      .subscribe(csv => {
        this.islandSPI = this.parseCsv(csv, 'island');
        if (this.selectedIsland() && !this.selectedDivision()) this.pickIsland(this.selectedIsland()!);
      });

    // Scope-specific (if selected)
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

  pickIsland(isle: Island) {
    this.selectedIsland.set(isle);
    this.selectedDivision.set(null);

    const scope = this.selectedScope();
    const groupCanon = new Set(getIslandsInSameCounty(isle.name).map(canonIsland));

    if (!scope) {
      // County outlines
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
        this.project = (projection as any);
        this.updateRasterRect();

        const features = fcCounty.features.map((f: any) => {
          const name = f.properties?.isle || f.properties?.island || f.properties?.name || 'Island';
          const id = String(name).toLowerCase().replace(/\s+/g, '-');
          return { id, key: id, name, short: name, divisions: [], feature: f } as Island;
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
    } else {
      // Scoped polygons
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
        this.project = (projection as any);
        this.updateRasterRect();

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

    // Update chart series with island SPI
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

    this.http.get<any>('hawaii_islands_simplified.geojson').subscribe(fc => {
      const projection = geoIdentity().reflectY(true).fitSize([560, 320], fc);
      const path = geoPath(projection as any);
      this.project = (projection as any);
      this.updateRasterRect();

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
      .filter((r: any) => r.state.toLowerCase() === 'statewide')
      .map((r: any) => ({ month: r.month, value: r.value }));
    this.tsData.set(stateData);
  }
}
