import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { AppComponent } from './app/app.component';
import { TableEffects } from './app/stores/table.effects';
import { tableReducer } from './app/stores/table.reducer';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimationsAsync(),
    provideStore({ table: tableReducer }),
    provideEffects([TableEffects]),
  ],
}).catch((error) => console.error(error));
