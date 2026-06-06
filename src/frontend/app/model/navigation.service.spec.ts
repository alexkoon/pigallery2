import {TestBed} from '@angular/core/testing';
import {Router} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {distinctUntilChanged, filter} from 'rxjs/operators';
import {NavigationService} from './navigation.service';
import {ShareService} from '../ui/gallery/share.service';
import {ResponseSharingDTO} from '../../../common/entities/SharingDTO';

class MockRouter {
  navigate = jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true));
  isActive = jasmine.createSpy('isActive').and.returnValue(false);
}

/**
 * Mimics ShareService state before a password-protected share is authenticated:
 * - isSharing() true  — a key is present in the URL
 * - wait()      resolves immediately — the router event has already fired
 * - currentSharing never emits — getSharing() hasn't been called yet (requires auth)
 */
class MockShareServicePreAuth {
  sharingKey = 'testkey123';
  private sharingSubject = new BehaviorSubject<ResponseSharingDTO | null>(null);

  currentSharing = this.sharingSubject
    .asObservable()
    .pipe(filter((s): s is ResponseSharingDTO => s !== null))
    .pipe(distinctUntilChanged());

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

describe('NavigationService', () => {
  let service: NavigationService;
  let router: MockRouter;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        NavigationService,
        {provide: Router, useClass: MockRouter},
        {provide: ShareService, useClass: MockShareServicePreAuth},
      ],
    });
    service = TestBed.inject(NavigationService);
    router = TestBed.inject(Router) as unknown as MockRouter;
  });

  /**
   * BUG 1 — toLogin() deadlock for password-protected shares.
   *
   * When a user visits a password-protected share link while unauthenticated,
   * toLogin() should immediately redirect to /shareLogin?sk=<key>.
   *
   * Current code (navigation.service.ts:34):
   *   await firstValueFrom(this.shareService.currentSharing)
   *
   * currentSharing only emits after getSharing() succeeds, which requires the user
   * to already be authenticated. For an unauthenticated password-protected share,
   * currentSharing never emits, so toLogin() hangs forever and the user sees a
   * blank screen.
   *
   * These tests FAIL with the current code and should PASS after the fix.
   */
  describe('Bug 1 – toLogin() deadlock for password-protected shares', () => {
    it('should resolve and redirect, not hang, when share is not yet authenticated', async () => {
      const TIMEOUT_MS = 300;

      const result = await Promise.race([
        service.toLogin().then(() => 'navigated'),
        new Promise<string>(resolve => setTimeout(() => resolve('timed_out'), TIMEOUT_MS)),
      ]);

      // Currently resolves as 'timed_out' because firstValueFrom(currentSharing)
      // never completes — the deadlock. After the fix it should navigate immediately.
      expect(result).toBe('navigated');
    });

    it('should navigate to shareLogin route with the sharing key', async () => {
      const TIMEOUT_MS = 300;

      await Promise.race([
        service.toLogin(),
        new Promise<void>(resolve => setTimeout(resolve, TIMEOUT_MS)),
      ]);

      // After the fix, router.navigate should be called with the share login route.
      // With the bug, this never happens because toLogin() hangs before reaching navigate().
      expect(router.navigate).toHaveBeenCalledWith(
        ['shareLogin'],
        jasmine.objectContaining({queryParams: {sk: 'testkey123'}})
      );
    });
  });
});
