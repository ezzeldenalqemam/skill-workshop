import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// The artifact host supplies its own <html>, so language and direction are set here.
document.documentElement.lang = 'ar';
document.documentElement.dir = 'rtl';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
