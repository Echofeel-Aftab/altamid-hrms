import { PhotoComponent } from './photo.component';
import { Component, Input, OnChanges } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChartPerson } from '../core/models';

interface Branch {
  person: ChartPerson;
  children: Branch[];
  open: boolean;
}

interface Line extends ChartPerson {
  depth: number;
  children: number;
  open: boolean;
}

@Component({
  selector: 'app-org-chart',
  imports: [RouterLink, PhotoComponent],
  template: `
    @if (!lines.length) {
      <p class="muted">No reporting line yet. Set a manager on each person and the chart fills in.</p>
    } @else {
      <div class="org-chart">
        @for (line of lines; track line.id) {
          <div class="org-line" [style.padding-left.px]="line.depth * 28">
            <button type="button" class="org-twist" [disabled]="!line.children" (click)="toggle(line.id)" [attr.aria-label]="line.open ? 'Collapse' : 'Expand'">
              {{ line.children ? (line.open ? '▾' : '▸') : '' }}
            </button>
            <app-photo size="sm" [personId]="line.id" [name]="line.name" />
            <a class="org-node" [class.is-exited]="line.status === 'exited'" [class.is-onboarding]="line.status === 'onboarding'" [routerLink]="'/people/' + line.id">
              <strong>{{ line.name }}</strong>
              <small>{{ line.designation || 'No designation' }} · {{ line.department || 'No department' }}</small>
              <em>{{ line.code }}{{ line.location ? ' · ' + line.location : '' }}{{ line.status === 'active' ? '' : ' · ' + line.status }}</em>
            </a>
          </div>
        }
      </div>
    }
  `,
})
export class OrgChartComponent implements OnChanges {
  @Input() people: ChartPerson[] = [];
  lines: Line[] = [];
  private readonly open = new Set<string>();
  private ready = false;

  ngOnChanges(): void {
    const branches = this.branches(this.people);
    if (!this.ready) {
      for (const branch of branches) this.keepOpen(branch, 0);
      this.ready = true;
    }
    this.lines = [];
    for (const branch of branches) this.flatten(branch, 0);
  }

  toggle(id: string): void {
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
    this.ngOnChanges();
  }

  private branches(people: ChartPerson[]): Branch[] {
    const byId = new Map(people.map((person) => [person.id, { person, children: [] as Branch[], open: this.open.has(person.id) }]));
    const roots: Branch[] = [];
    for (const branch of byId.values()) {
      const parent = branch.person.managerId ? byId.get(branch.person.managerId) : undefined;
      if (parent) parent.children.push(branch);
      else roots.push(branch);
    }
    const sort = (list: Branch[], seen = new Set<string>()) => {
      list.sort((a, b) => a.person.name.localeCompare(b.person.name));
      list.forEach((item) => {
        if (seen.has(item.person.id)) return;
        seen.add(item.person.id);
        sort(item.children, seen);
      });
    };
    sort(roots);
    return roots;
  }

  private keepOpen(branch: Branch, depth: number, seen = new Set<string>()): void {
    if (seen.has(branch.person.id)) return;
    seen.add(branch.person.id);
    if (depth < 2 && branch.children.length) this.open.add(branch.person.id);
    branch.children.forEach((child) => this.keepOpen(child, depth + 1, seen));
  }

  private flatten(branch: Branch, depth: number, seen = new Set<string>()): void {
    if (seen.has(branch.person.id)) return;
    seen.add(branch.person.id);
    const open = this.open.has(branch.person.id);
    this.lines.push({ ...branch.person, depth, children: branch.children.length, open });
    if (open) branch.children.forEach((child) => this.flatten(child, depth + 1, seen));
  }
}
