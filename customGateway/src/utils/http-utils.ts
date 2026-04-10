export async function readBodyBuffer(request: Request) {
  return Buffer.from(await request.arrayBuffer());
}
