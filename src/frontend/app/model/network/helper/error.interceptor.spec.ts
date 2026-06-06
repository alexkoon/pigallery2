import {TestBed} from '@angular/core/testing';
import {HttpHandler, HttpRequest} from '@angular/common/http';
import {throwError} from 'rxjs';
import {ErrorInterceptor} from './error.interceptor';
import {AuthenticationService} from '../authentication.service';
import {NavigationService} from '../../navigation.service';

class MockAuthenticationService {
  logout = jasmine.createSpy('logout').and.returnValue(Promise.resolve());
  isAuthenticated = jasmine.createSpy('isAuthenticated').and.returnValue(false);
}

class MockNavigationService {
  toError = jasmine.createSpy('toError').and.returnValue(Promise.resolve(true));
  toLogin = jasmine.createSpy('toLogin').and.returnValue(Promise.resolve(true));
}

const make401Handler = (): HttpHandler => ({
  handle: () => throwError({status: 401, error: {message: 'Unauthorized'}}),
} as HttpHandler);

describe('ErrorInterceptor', () => {
  let interceptor: ErrorInterceptor;
  let authService: MockAuthenticationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ErrorInterceptor,
        {provide: AuthenticationService, useClass: MockAuthenticationService},
        {provide: NavigationService, useClass: MockNavigationService},
      ],
    });
    interceptor = TestBed.inject(ErrorInterceptor);
    authService = TestBed.inject(AuthenticationService) as unknown as MockAuthenticationService;
  });

  /**
   * BUG 2 (interceptor side) — the other half of the 401 loop.
   *
   * When a 401 response arrives the interceptor unconditionally calls logout().
   * Combined with logout() calling getSessionUser() (proven in
   * autehentication.service.spec.ts), each getSessionUser() HTTP call can itself
   * return 401, firing the interceptor again, calling logout() again, indefinitely.
   *
   * The interceptor should not call logout() when the user is already
   * unauthenticated — doing so only adds another lap to the loop.
   *
   * These tests FAIL with the current code and should PASS after the fix.
   */
  describe('Bug 2 – interceptor calls logout() even when already unauthenticated', () => {
    it('should not call logout() when the user is already unauthenticated', (done) => {
      authService.isAuthenticated.and.returnValue(false);

      interceptor.intercept({} as HttpRequest<unknown>, make401Handler()).subscribe({
        error: () => {
          // With current code: logout IS called unconditionally → test FAILS (proves bug).
          // After fix: logout is not called when already unauthenticated → test PASSES.
          expect(authService.logout).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should call logout() when the user is authenticated and receives a 401', (done) => {
      authService.isAuthenticated.and.returnValue(true);

      interceptor.intercept({} as HttpRequest<unknown>, make401Handler()).subscribe({
        error: () => {
          // A 401 while authenticated is a legitimate logout trigger.
          // This behaviour should be preserved by the fix.
          expect(authService.logout).toHaveBeenCalledTimes(1);
          done();
        },
      });
    });
  });
});
