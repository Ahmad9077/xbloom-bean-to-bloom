interface PublicAliasEnv {
  readonly APP: Fetcher;
}

/** Public branded entry point. The application and all secrets remain owned by the main Worker. */
export default {
  fetch(request: Request, env: PublicAliasEnv): Promise<Response> {
    return env.APP.fetch(request);
  },
};
