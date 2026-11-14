import { Component, ElementRef, forwardRef, HostListener, Input, OnDestroy, ViewChild } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

const KEEP = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'HR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'A']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'META', 'LINK', 'TITLE', 'HEAD']);

export function cleanRich(html: string): string {
  const box = document.createElement('template');
  box.innerHTML = html;
  const walk = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) return [document.createTextNode(node.textContent || '')];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const el = node as HTMLElement;
    if (DROP.has(el.tagName)) return [];
    const kids = Array.from(el.childNodes).flatMap(walk);
    let tag = el.tagName;
    if (tag === 'DIV') tag = 'P';
    if (tag === 'B') tag = 'STRONG';
    if (tag === 'I') tag = 'EM';
    if (tag === 'STRIKE') tag = 'S';
    if (tag === 'H1') tag = 'H2';
    if (!KEEP.has(tag)) return kids;
    const next = document.createElement(tag);
    if (tag === 'A') {
      const href = (el.getAttribute('href') || '').trim();
      if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
        next.setAttribute('href', href);
        next.setAttribute('target', '_blank');
        next.setAttribute('rel', 'noopener noreferrer');
      }
    }
    kids.forEach((kid) => next.appendChild(kid));
    return [next];
  };
  const out = document.createElement('div');
  Array.from(box.content.childNodes).flatMap(walk).forEach((node) => out.appendChild(node));
  return out.innerHTML;
}

export function plainText(html: string): string {
  const box = document.createElement('div');
  box.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h2|h3|h4|blockquote)>/gi, '$&\n');
  return (box.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function looksRich(value: string): boolean {
  return /<\/?(p|br|ul|ol|li|h2|h3|h4|strong|em|u|s|a|blockquote)\b/i.test(value);
}

export function asRich(value: string): string {
  if (!value) return '';
  if (looksRich(value)) return value;
  const safe = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe.split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`).join('');
}

interface Tool { cmd: string; icon: string; label: string; arg?: string; key?: string }

@Component({
  selector: 'app-rich-editor',
  imports: [FormsModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RichEditorComponent), multi: true }],
  template: `
    <div class="rte" [class.is-focus]="focused" [class.is-disabled]="disabled">
      <div class="rte-bar" role="toolbar" [attr.aria-label]="label + ' formatting'">
        @for (group of groups; track $index) {
          <div class="rte-group">
            @for (tool of group; track tool.cmd + (tool.arg || '')) {
              <button type="button" class="rte-btn" [class.is-on]="isOn(tool)" [attr.aria-pressed]="isOn(tool)" [attr.aria-label]="tool.label" [title]="tool.label + (tool.key ? ' (' + tool.key + ')' : '')"
                [disabled]="disabled" (mousedown)="$event.preventDefault()" (click)="run(tool)">
                <i [class]="tool.icon"></i>
              </button>
            }
          </div>
        }
        <span class="rte-count" [class.is-over]="max && count > max">{{ count }}{{ max ? ' / ' + max : '' }}</span>
      </div>
      @if (linking) {
        <form class="rte-link" (ngSubmit)="applyLink()">
          <i class="bi bi-link-45deg" aria-hidden="true"></i>
          <input #linkInput name="href" [(ngModel)]="href" placeholder="https://example.com" aria-label="Link address" (keydown.escape)="linking = false">
          <button type="submit" class="btn btn-sm btn-primary">Add link</button>
          <button type="button" class="btn btn-sm btn-ghost" (click)="linking = false">Cancel</button>
        </form>
      }
      <div #area class="rte-area" [attr.id]="inputId || null" contenteditable="true" role="textbox" aria-multiline="true" [attr.aria-label]="label"
        [attr.contenteditable]="!disabled" [attr.data-placeholder]="placeholder" [style.min-height.px]="minHeight"
        (input)="changed()" (focus)="onFocus()" (blur)="focused = false; touched()" (paste)="paste($event)" (keydown)="keys($event)"></div>
    </div>
  `,
})
export class RichEditorComponent implements ControlValueAccessor, OnDestroy {
  @Input() label = 'Text';
  @Input() placeholder = 'Write here…';
  @Input() max = 0;
  @Input() minHeight = 140;
  @Input() inputId = '';
  @ViewChild('area', { static: true }) area!: ElementRef<HTMLDivElement>;
  @ViewChild('linkInput') linkInput?: ElementRef<HTMLInputElement>;

  readonly groups: Tool[][] = [
    [
      { cmd: 'bold', icon: 'bi bi-type-bold', label: 'Bold', key: 'Ctrl+B' },
      { cmd: 'italic', icon: 'bi bi-type-italic', label: 'Italic', key: 'Ctrl+I' },
      { cmd: 'underline', icon: 'bi bi-type-underline', label: 'Underline', key: 'Ctrl+U' },
      { cmd: 'strikeThrough', icon: 'bi bi-type-strikethrough', label: 'Strikethrough' },
    ],
    [
      { cmd: 'formatBlock', arg: 'h3', icon: 'bi bi-type-h3', label: 'Heading' },
      { cmd: 'formatBlock', arg: 'p', icon: 'bi bi-paragraph', label: 'Paragraph' },
      { cmd: 'formatBlock', arg: 'blockquote', icon: 'bi bi-quote', label: 'Quote' },
    ],
    [
      { cmd: 'insertUnorderedList', icon: 'bi bi-list-ul', label: 'Bullet list' },
      { cmd: 'insertOrderedList', icon: 'bi bi-list-ol', label: 'Numbered list' },
    ],
    [
      { cmd: 'link', icon: 'bi bi-link-45deg', label: 'Add link', key: 'Ctrl+K' },
      { cmd: 'unlink', icon: 'bi bi-link', label: 'Remove link' },
      { cmd: 'removeFormat', icon: 'bi bi-eraser', label: 'Clear formatting' },
    ],
    [
      { cmd: 'undo', icon: 'bi bi-arrow-counterclockwise', label: 'Undo', key: 'Ctrl+Z' },
      { cmd: 'redo', icon: 'bi bi-arrow-clockwise', label: 'Redo', key: 'Ctrl+Y' },
    ],
  ];
  focused = false;
  disabled = false;
  linking = false;
  href = '';
  count = 0;
  private active = new Set<string>();
  private saved: Range | null = null;
  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    const html = asRich(value || '');
    if (this.area.nativeElement.innerHTML !== html) this.area.nativeElement.innerHTML = html;
    this.count = plainText(html).length;
  }

  registerOnChange(fn: (value: string) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled = disabled; }

  @HostListener('document:selectionchange')
  syncState(): void {
    const selection = document.getSelection();
    if (!selection || !selection.anchorNode || !this.area.nativeElement.contains(selection.anchorNode)) return;
    const next = new Set<string>();
    for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
      try { if (document.queryCommandState(cmd)) next.add(cmd); } catch { /* unsupported */ }
    }
    const block = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
    if (block) next.add('formatBlock:' + block);
    this.active = next;
  }

  isOn(tool: Tool): boolean {
    return this.active.has(tool.arg ? tool.cmd + ':' + tool.arg : tool.cmd);
  }

  run(tool: Tool): void {
    if (this.disabled) return;
    this.area.nativeElement.focus();
    if (tool.cmd === 'link') {
      this.openLink();
      return;
    }
    if (tool.cmd === 'formatBlock') {
      const current = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
      document.execCommand('formatBlock', false, current === tool.arg && tool.arg !== 'p' ? 'p' : `<${tool.arg}>`);
    } else if (tool.cmd === 'removeFormat') {
      document.execCommand('removeFormat');
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand(tool.cmd);
    }
    this.changed();
    this.syncState();
  }

  keys(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openLink();
    }
  }

  paste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const html = data.getData('text/html');
    if (html) document.execCommand('insertHTML', false, cleanRich(html));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    this.changed();
  }

  changed(): void {
    const raw = this.area.nativeElement.innerHTML;
    const text = plainText(raw);
    this.count = text.length;
    this.onChange(text ? cleanRich(raw) : '');
  }

  onFocus(): void {
    this.focused = true;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* older engines */ }
  }

  touched(): void {
    this.onTouched();
  }

  private openLink(): void {
    const selection = document.getSelection();
    this.saved = selection && selection.rangeCount && this.area.nativeElement.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    const anchor = selection?.anchorNode?.parentElement?.closest('a');
    this.href = anchor?.getAttribute('href') || 'https://';
    this.linking = true;
    setTimeout(() => this.linkInput?.nativeElement.select());
  }

  applyLink(): void {
    let href = this.href.trim();
    this.linking = false;
    if (!href || href === 'https://') return;
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(href)) href = href.includes('@') && !href.includes('/') ? 'mailto:' + href : 'https://' + href;
    this.area.nativeElement.focus();
    const selection = document.getSelection();
    if (this.saved && selection) {
      selection.removeAllRanges();
      selection.addRange(this.saved);
    }
    if (selection && selection.isCollapsed) {
      const safe = href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      document.execCommand('insertHTML', false, `<a href="${safe}">${safe}</a>`);
    } else {
      document.execCommand('createLink', false, href);
    }
    this.changed();
  }

  ngOnDestroy(): void {
    this.saved = null;
  }
}

@Component({
  selector: 'app-rich-view',
  template: `<div class="rte-view" [innerHTML]="html"></div>`,
})
export class RichViewComponent {
  html = '';
  @Input() set value(value: string | null | undefined) {
    this.html = asRich(value || '');
  }
}
