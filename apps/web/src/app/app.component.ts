import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sweet, SweetHostComponent } from './shared/sweet';
import { ToastHostComponent } from './shared/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SweetHostComponent, ToastHostComponent],
  template: '<router-outlet /><app-sweet-host /><app-toast-host />',
})
export class AppComponent {
  /** Ensures Sweet installs the native alert/confirm guards on boot. */
  private readonly sweet = inject(Sweet);
}
