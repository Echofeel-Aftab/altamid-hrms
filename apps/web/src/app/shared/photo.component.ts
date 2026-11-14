import { Component, inject, Input, OnChanges, OnDestroy } from '@angular/core';
import { PhotoBook } from '../core/photo-book';

/** A person's photo, or their initials until one is added. Give an id, a code, or a name. */
@Component({
  selector: 'app-photo',
  host: {
    '[class]': "size === 'lg' ? 'p-avatar' : 'av av-' + size",
    '[class.has-photo]': '!!url',
    'aria-hidden': 'true',
  },
  template: `@if (url) { <img [src]="url" alt="" loading="lazy" decoding="async"> } @else { {{ initials }} }`,
})
export class PhotoComponent implements OnChanges, OnDestroy {
  private readonly book = inject(PhotoBook);
  @Input() personId = '';
  @Input() code = '';
  @Input() stamp: string | null = null;
  @Input() name = '';
  @Input() size: 'lg' | 'md' | 'sm' | 'xs' = 'lg';
  url = '';
  private ask = 0;
  private readonly stop = this.book.listen(() => {
    if (this.stamp === null) void this.ngOnChanges();
  });

  ngOnDestroy(): void {
    this.stop();
  }

  get initials(): string {
    return this.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  }

  async ngOnChanges(): Promise<void> {
    const ask = ++this.ask;
    this.url = '';
    try {
      let id = this.personId;
      let stamp = this.stamp;
      if (stamp === null) {
        const found = await this.book.find({ id: this.personId, code: this.code, name: this.name });
        if (!found) return;
        id = found.id;
        stamp = found.stamp;
      } else if (id) {
        this.book.update(id, stamp);
      }
      if (!id || !stamp) return;
      const url = await this.book.url(id, stamp);
      if (ask === this.ask) this.url = url;
    } catch {
      if (ask === this.ask) this.url = '';
    }
  }
}
