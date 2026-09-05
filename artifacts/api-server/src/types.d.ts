declare global {
  namespace Express {
    interface Request {
      worldForgeApiKeyId?: string;
      worldForgeOwnerId?: string;
    }
  }
}

export {};
declare module "pngjs" {
  export const PNG: {
    sync: {
      read(input: Uint8Array): {
        width: number;
        height: number;
        data: Uint8Array;
      };
    };
  };
}
