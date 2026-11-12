import { DynamicModule, Module } from "@nestjs/common";
import { loadEnv } from "./env";

@Module({
  providers: [
    {
      provide: "ENV",
      useFactory: () => loadEnv(),
    },
  ],
  exports: ["ENV"],
})
export class EnvModule {
  static forRoot(): DynamicModule {
    return {
      module: EnvModule,
      providers: [
        {
          provide: "ENV",
          useFactory: () => loadEnv(),
        },
      ],
      exports: ["ENV"],
    };
  }
}
