import { Module } from "@nestjs/common";
import { STORAGE_ADAPTER } from "./storage.interface";
import { LocalStorageAdapter } from "./local-storage.adapter";
import { StorageService } from "./storage.service";

@Module({
  providers: [
    {
      provide: STORAGE_ADAPTER,
      useClass: LocalStorageAdapter,
    },
    StorageService,
  ],
  exports: [StorageService, STORAGE_ADAPTER],
})
export class StorageModule {}
