import { Component, ElementRef, HostListener, inject, input, model } from '@angular/core';

export interface LeavePick {
  id: string;
  name: string;
  entitled: number;
  left: number;
  limited?: boolean;
}

@Component({
  selector: 'app-leave-type-pick',
  template: `
    <div class="leave-pick" [class.is-open]="open">
      <button [id]="controlId()" type="button" class="leave-pick-btn" aria-haspopup="listbox" [attr.aria-expanded]="open" (click)="open = !open">
        <span class="leave-pick-name">{{ current?.name || 'Choose a leave type' }}</span>
        @if (current) { <span class="leave-pick-meta">{{ balanceOf(current) }}</span> }
        <span class="leave-pick-caret" aria-hidden="true"></span>
      </button>
      @if (open) {
        <ul class="leave-pick-menu" role="listbox">
          @for (type of types(); track type.id) {
            <li>
              <button type="button" role="option" class="leave-pick-option" [attr.aria-selected]="type.id === value()" (click)="choose(type.id)">
                <span class="leave-pick-name">{{ type.name }}</span>
                <span class="leave-pick-meta">{{ balanceOf(type) }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class LeaveTypePickComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly types = input<LeavePick[]>([]);
  readonly value = model('');
  readonly controlId = input('leave-type');
  open = false;

  get current(): LeavePick | undefined {
    return this.types().find((type) => type.id === this.value()) || this.types()[0];
  }

  balanceOf(type: LeavePick): string {
    if (!(type.limited ?? !!type.entitled)) return 'Open';
    return type.left + (type.left === 1 ? ' day left' : ' days left');
  }

  choose(id: string): void {
    this.value.set(id);
    this.open = false;
  }

  @HostListener('document:click', ['$event'])
  closeOutside(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open = false;
  }

  @HostListener('document:keydown.escape')
  close(): void {
    this.open = false;
  }
}
