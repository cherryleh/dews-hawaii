import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpiChartComponent } from './spi-chart.component';

describe('SpiChartComponent', () => {
  let component: SpiChartComponent;
  let fixture: ComponentFixture<SpiChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpiChartComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpiChartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
