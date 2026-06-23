import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../database/prisma.service";
import { reduceTmrDetails, type GetUserDetailsData } from "./tmr-data.types";

const TMR_TIMEOUT = 10_000;

interface BackOfficeResponse<T> {
  status: string;
  data: T;
}

interface UserSearchItem {
  userId: string;
  fullName?: string;
  emailId?: string;
}

@Injectable()
export class TmrDataService {
  private readonly logger = new Logger(TmrDataService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService
  ) {}

  private getConfig(): {
    baseUrl: string;
    apiKey: string;
  } | null {
    const baseUrl = this.config.get<string>("TMR_DATA_SERVICE_BASE_URL");
    const apiKey = this.config.get<string>("TMR_DATA_SERVICE_API_KEY");
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey };
  }

  private async post<T>(
    cfg: { baseUrl: string; apiKey: string },
    path: string,
    body: unknown
  ): Promise<T> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Service-to-service auth: the secret rides in Authorization (so logging
        // tools auto-redact it); x-auth-mode is an inert routing flag that tells
        // the back-office to take the API-key branch instead of the frontend JWT.
        Authorization: `Bearer ${cfg.apiKey}`,
        "x-auth-mode": "service",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TMR_TIMEOUT),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `tmr_data_service ${path} returned ${res.status}: ${text.slice(0, 300)}`
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `tmr_data_service ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`
      );
    }
  }

  async syncUser(userId: string): Promise<void> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) return;

    const cfg = this.getConfig();
    if (!cfg) {
      this.logger.warn(
        "TMR_DATA_SERVICE_BASE_URL or TMR_DATA_SERVICE_API_KEY not configured — skipping TMR sync"
      );
      return;
    }

    try {
      // Step 1: resolve user id from email
      const searchRes = await this.post<BackOfficeResponse<UserSearchItem[]>>(
        cfg,
        "/back-office/getUsersByFuzzySearch",
        { emailId: user.email }
      );
      const matchedUser = (searchRes.data ?? []).find(
        (u) => u.emailId?.toLowerCase() === user.email.toLowerCase()
      );
      if (!matchedUser) {
        await this.db.user.update({
          where: { id: userId },
          data: { tmrMetadataStatus: "NOT_FOUND", tmrMetadataAt: new Date() },
        });
        return;
      }

      // Step 2: fetch user details
      const detailsRes = await this.post<
        BackOfficeResponse<GetUserDetailsData>
      >(cfg, "/back-office/getUserDetails", { userId: matchedUser.userId });
      const metadata = reduceTmrDetails(detailsRes.data ?? {});

      await this.db.user.update({
        where: { id: userId },
        data: {
          tmrUserId: matchedUser.userId,
          tmrMetadata: metadata as object,
          tmrMetadataStatus: "OK",
          tmrMetadataAt: new Date(),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`TmrDataService.syncUser userId=${userId}: ${msg}`);
      await this.db.user.update({
        where: { id: userId },
        data: { tmrMetadataStatus: "ERROR", tmrMetadataAt: new Date() },
      });
    }
  }
}
