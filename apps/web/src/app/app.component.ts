import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SweetHostComponent } from './shared/sweet';
import { ToastHostComponent } from './shared/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SweetHostComponent, ToastHostComponent],
  template: '<router-outlet /><app-sweet-host /><app-toast-host />',
})
export class AppComponent {}
