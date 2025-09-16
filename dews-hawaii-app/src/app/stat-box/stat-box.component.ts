import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-box',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stat-box.component.html',
  styleUrls: ['./stat-box.component.css']
})
export class StatBoxComponent {
  @Input() label!: string;
  @Input() value!: string;
}