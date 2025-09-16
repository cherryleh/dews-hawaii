import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./climate-dashboard/climate-dashboard.component').then(
        (m) => m.ClimateDashboardComponent
      ),
  },
];
