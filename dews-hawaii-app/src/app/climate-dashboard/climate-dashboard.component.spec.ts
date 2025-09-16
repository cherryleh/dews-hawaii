import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClimateDashboardComponent } from './climate-dashboard.component';

describe('ClimateDashboardComponent', () => {
  let component: ClimateDashboardComponent;
  let fixture: ComponentFixture<ClimateDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClimateDashboardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClimateDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
