import {inject, TestBed} from '@angular/core/testing';
import {UserService} from './user.service';
import {UserDTO} from '../../../../common/entities/UserDTO';
import {LoginCredential} from '../../../../common/entities/LoginCredential';
import {AuthenticationService} from './authentication.service';
import {NetworkService} from './network.service';
import {ErrorDTO} from '../../../../common/entities/Error';
import {VersionService} from '../version.service';
import {ShareService} from '../../ui/gallery/share.service';
import {NavigationService} from '../navigation.service';

class MockUserService {
  public login(credential: LoginCredential): Promise<UserDTO> {
    return Promise.resolve({name: 'testUserName'} as UserDTO);
  }

  public async logout(): Promise<string> {
    return null;
  }

  public async getSessionUser(): Promise<UserDTO> {
    return null;
  }
}

class MockNetworkService {
  addGlobalErrorHandler(fn: (error: ErrorDTO) => boolean): void {
    // mock fn
  }
}

class MockShareService {
  sharingKey: string = null;

  onNewUser(user: any): void {
    // mock fn
  }

  wait(): Promise<void> {
    return Promise.resolve();
  }

  isSharing(): boolean {
    return this.sharingKey != null;
  }

  getSharingKey(): string {
    return this.sharingKey;
  }
}

class MockNavigationService {
  toError(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('AuthenticationService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        VersionService,
        {provide: NetworkService, useClass: MockNetworkService},
        {provide: UserService, useClass: MockUserService},
        {provide: ShareService, useClass: MockShareService},
        {provide: NavigationService, useClass: MockNavigationService},
        AuthenticationService,
      ],
    });
  });

  it('should call UserDTO service login', inject(
      [AuthenticationService, UserService],
      async (authService: AuthenticationService, userService: UserService) => {
        spyOn(userService, 'login').and.callThrough();

        expect(userService.login).not.toHaveBeenCalled();
        await authService.login(null);
        expect(userService.login).toHaveBeenCalled();
      }
  ));

  it('should have NO Authenticated use', inject(
      [AuthenticationService],
      (authService: AuthenticationService) => {
        expect(authService.user.value).toBe(null);
        expect(authService.isAuthenticated()).toBe(false);
      }
  ));

  it('should have Authenticated use', (done) =>
      inject([AuthenticationService], (authService: AuthenticationService) => {
        spyOn(authService.user, 'next').and.callThrough();
        authService.user.subscribe((user) => {
          if (user == null) {
            return;
          }
          expect(authService.user.next).toHaveBeenCalled();
          expect(authService.user.value).not.toBe(null);
          expect(authService.isAuthenticated()).toBe(true);
          done();
        });
        authService.login({} as any);
      })());

  /**
   * BUG 2 — 401 infinite loop for password-protected shares.
   *
   * When a 401 response arrives while the user is in a sharing session:
   *   error.interceptor.ts  → calls authenticationService.logout()
   *   authentication.service.ts logout() → calls getSessionUser() when isSharing()
   *   getSessionUser() → GET /user/me?sk=<key> → 401 → interceptor fires → logout() → …
   *
   * The loop repeats until the browser tab is killed or the stack overflows.
   *
   * The root issue in AuthenticationService: logout() should NOT call getSessionUser()
   * when the user is already unauthenticated (i.e. after clearing this.user to null),
   * because that call can itself trigger another 401 and restart the cycle.
   *
   * These tests FAIL with the current code and should PASS after the fix.
   */
  describe('Bug 2 – logout() triggers getSessionUser() during sharing, enabling 401 loop', () => {
    it('should not call getSessionUser() after logging out when sharing is active',
      inject(
        [AuthenticationService, UserService, ShareService],
        async (authService: AuthenticationService, userService: UserService, shareService: MockShareService) => {
          shareService.sharingKey = 'testkey123';

          spyOn(userService, 'getSessionUser').and.returnValue(Promise.resolve(null));

          await authService.logout();

          // BUG: with current code getSessionUser IS called here.
          // This creates the loop: the HTTP call can return 401, which fires the
          // error interceptor, which calls logout() again, which calls
          // getSessionUser() again, indefinitely.
          expect(userService.getSessionUser).not.toHaveBeenCalled();
        }
      )
    );

    it('should not call getSessionUser() on each successive logout() call when sharing',
      inject(
        [AuthenticationService, UserService, ShareService],
        async (authService: AuthenticationService, userService: UserService, shareService: MockShareService) => {
          shareService.sharingKey = 'testkey123';

          let callCount = 0;
          spyOn(userService, 'getSessionUser').and.callFake(() => {
            callCount++;
            return Promise.resolve(null);
          });

          // Each logout() call independently triggers getSessionUser() when sharing is
          // active. This proves the mechanism: every external trigger of logout()
          // (such as the error interceptor firing on a 401) adds another getSessionUser()
          // call, each of which can itself produce a 401 that re-triggers the interceptor.
          await authService.logout();
          await authService.logout();
          await authService.logout();

          // After the fix: 0 calls (logout should not trigger getSessionUser).
          // With the bug: 3 calls — one per logout() invocation.
          expect(callCount).toBe(0);
        }
      )
    );
  });
});
