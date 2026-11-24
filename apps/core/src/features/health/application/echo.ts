export const echo = async <T extends { readonly message: string }>(input: T) => ({
  message: input.message,
});
