import { Body, Controller, Request, UseGuards } from '@nestjs/common';
import { apiContract } from '@pomi/shared';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Request as ExpressRequest } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { BillingAnonymousRateLimitStore } from './billing-anonymous-rate-limit.store';
import { BillingService } from './billing.service';
import { BillingCheckoutService } from './billing-checkout.service';
import { AppleNotificationDto } from './dto/apple-notification.dto';
import { ClaimSubscriptionDto } from './dto/claim-subscription.dto';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly checkouts: BillingCheckoutService,
    private readonly anonymousRateLimits: BillingAnonymousRateLimitStore
  ) {}

  @TsRestHandler(apiContract.billing.createCheckout)
  async createCheckout(@Request() request: ExpressRequest): Promise<unknown> {
    return tsRestHandler(apiContract.billing.createCheckout, async () => {
      await this.anonymousRateLimits.assertCheckoutCreationAllowed(request.ip);
      return {
        status: 201,
        body: await this.checkouts.create(),
      };
    });
  }

  @TsRestHandler(apiContract.billing.verifyCheckoutPurchase)
  async verifyCheckoutPurchase(
    @Request() request: ExpressRequest,
    @Body() body: ClaimSubscriptionDto
  ): Promise<unknown> {
    return tsRestHandler(
      apiContract.billing.verifyCheckoutPurchase,
      async () => {
        await this.anonymousRateLimits.assertCheckoutVerificationAllowed(
          request.ip,
          body.checkoutToken
        );
        await this.billing.verifyCheckoutPurchase(body);
        return { status: 200, body: { success: true } };
      }
    );
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.billing.entitlement)
  async entitlement(@Request() request: ExpressRequest): Promise<unknown> {
    return tsRestHandler(apiContract.billing.entitlement, async () => ({
      status: 200,
      body: await this.billing.getEntitlement(request['user'].sub),
    }));
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.billing.sync)
  async sync(
    @Request() request: ExpressRequest,
    @Body() body: SyncSubscriptionDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.billing.sync, async () => ({
      status: 200,
      body: await this.billing.sync(request['user'].sub, body),
    }));
  }

  @UseGuards(AuthGuard)
  @TsRestHandler(apiContract.billing.claimCheckout)
  async claimCheckout(
    @Request() request: ExpressRequest,
    @Body() body: ClaimSubscriptionDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.billing.claimCheckout, async () => ({
      status: 200,
      body: await this.billing.claim(request['user'].sub, body),
    }));
  }

  @TsRestHandler(apiContract.billing.appleNotifications)
  async appleNotifications(
    @Body() body: AppleNotificationDto
  ): Promise<unknown> {
    return tsRestHandler(apiContract.billing.appleNotifications, async () => {
      await this.billing.processAppleNotification(body.signedPayload);
      return { status: 200, body: { success: true } };
    });
  }
}
