import { QStashTaskQueue } from './qstash-task-queue.impl';

const UPSTASH_SIGNATURE_HEADER = 'Upstash-Signature';

export async function verifyQStashRequest<Req extends Request, Queue extends QStashTaskQueue<unknown>>(request: Req, queue: Queue) {
  try {
    const body = await request.text();
    const signature = request.headers.get(UPSTASH_SIGNATURE_HEADER);

    if (!signature) {
      return Promise.reject('Missing Upstash-Signature header');
    }

    return queue.verify({
      body,
      signature,
    });
  } catch (error) {
    console.error(`Failed to verify request: ${error}`);

    return Promise.reject(`Failed to verify request`);
  }
}