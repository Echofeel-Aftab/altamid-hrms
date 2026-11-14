import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { badgeLook } from '../core/badges';

export interface FreshBadge { id: string; key: string; label: string; from: string; note: string; at: string }

interface Spark { style: string; kind: 'spark' | 'paper' }

const COLOURS = ['#e8c85c', '#f3d76e', '#103860', '#2078a8', '#12a15f', '#e0483e', '#f59e0b', '#ec4899'];

@Component({
  selector: 'app-celebrate',
  imports: [RouterLink],
  template: `
    <div class="party" role="dialog" aria-modal="true" aria-labelledby="party-title">
      @if (sparks.length) {
        <div class="party-sky" aria-hidden="true">
          @for (spark of sparks; track $index) { <i [class]="'party-' + spark.kind" [attr.style]="spark.style"></i> }
        </div>
      }
      <div class="party-card">
        <div class="party-medal" [class]="'party-medal tone-' + look(first.key).tone">
          <i class="bi" [class]="look(first.key).icon"></i>
        </div>
        <p class="eyebrow">{{ badges.length === 1 ? 'New badge' : badges.length + ' new badges' }}</p>
        <h2 id="party-title">{{ first.from }} gave you {{ first.label }}</h2>
        @if (first.note) { <p class="party-note">“{{ first.note }}”</p> }
        @if (badges.length > 1) {
          <ul class="party-list">
            @for (item of badges.slice(1, 5); track item.id) {
              <li><span class="badge-dot" [class]="'badge-dot tone-' + look(item.key).tone"><i class="bi" [class]="look(item.key).icon"></i></span> {{ item.label }} <small>from {{ item.from }}</small></li>
            }
            @if (badges.length > 5) { <li class="muted">and {{ badges.length - 5 }} more</li> }
          </ul>
        }
        <div class="actions">
          <button class="btn btn-gold" type="button" (click)="close()"><i class="bi bi-emoji-smile"></i> Lovely, thanks</button>
          <a class="btn btn-ghost" routerLink="/recognition" (click)="close()">See my badges</a>
        </div>
      </div>
    </div>
  `,
})
export class CelebrateComponent implements OnInit, OnDestroy {
  @Input({ required: true }) badges: FreshBadge[] = [];
  @Output() closed = new EventEmitter<void>();
  sparks: Spark[] = [];
  private timer = 0;

  get first(): FreshBadge {
    return this.badges[0];
  }

  look = badgeLook;

  ngOnInit(): void {
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) return;
    const bursts = [[22, 30, 0], [78, 26, 260], [50, 18, 520], [32, 46, 900], [70, 44, 1150]];
    for (const [left, top, delay] of bursts) {
      const count = 14;
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
        const reach = 90 + Math.random() * 80;
        this.sparks.push({
          kind: 'spark',
          style: `left:${left}%;top:${top}%;background:${COLOURS[(index + delay) % COLOURS.length]};`
            + `--x:${Math.round(Math.cos(angle) * reach)}px;--y:${Math.round(Math.sin(angle) * reach)}px;animation-delay:${delay}ms`,
        });
      }
    }
    for (let index = 0; index < 28; index += 1) {
      this.sparks.push({
        kind: 'paper',
        style: `left:${Math.round(Math.random() * 100)}%;background:${COLOURS[index % COLOURS.length]};`
          + `--x:${Math.round(Math.random() * 120 - 60)}px;--r:${Math.round(Math.random() * 540 - 270)}deg;`
          + `animation-delay:${Math.round(Math.random() * 900)}ms;animation-duration:${2200 + Math.round(Math.random() * 1200)}ms`,
      });
    }
    this.timer = window.setTimeout(() => (this.sparks = []), 4600);
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.timer);
  }

  close(): void {
    this.closed.emit();
  }
}
