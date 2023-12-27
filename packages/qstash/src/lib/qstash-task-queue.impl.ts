import { Client, Receiver } from '@upstash/qstash';

type VerifyParams = {
  body: string;
  signature: string;
}

type QstashQueueConfig = {
  url?: string;
  token?: string;
  currentSigningKey?: string;
  nextSigningKey?: string;
}

type BaseQstashQueueParams = {
  delay?: number;
  deduplicationId?: string;
};

const QSTASH_QUEUE_URL = process.env['QSTASH_QUEUE_URL'];
const QSTASH_TOKEN = process.env['QSTASH_TOKEN'];
const QSTASH_CURRENT_SIGNING_KEY = process.env['QSTASH_CURRENT_SIGNING_KEY'];
const QSTASH_NEXT_SIGNING_KEY = process.env['QSTASH_NEXT_SIGNING_KEY'];

/**
 * TaskQueue class is an implementation of the AbstractTaskQueue interface using QStash.
 * It provides methods for creating a chatbot message and verifying the authenticity of a message using a digital signature.
 *
 * @class QStashTaskQueue
 */
export class QStashTaskQueue<Body> {
  private readonly config: QstashQueueConfig;
  private readonly client: Client;

  private get url() {
    return this.config?.url || QSTASH_QUEUE_URL;
  }

  private get token() {
    return this.config?.token || QSTASH_TOKEN;
  }

  private get currentSigningKey() {
    return this.config?.currentSigningKey || QSTASH_CURRENT_SIGNING_KEY;
  }

  private get nextSigningKey() {
    return this.config?.nextSigningKey || QSTASH_NEXT_SIGNING_KEY;
  }

  constructor(
    config?: Partial<QstashQueueConfig>,
  ) {
    this.config = config || {};
    this.client = this.createClient();
  }

  async create(params: { body: Body } & BaseQstashQueueParams) {
    const url = this.url;

    if (!url) {
      throw new Error('QSTASH_QUEUE_URL is required');
    }

    try {
      return this.client.publishJSON({
        url,
        body: params.body,
        delay: params.delay,
        deduplicationId: params.deduplicationId,
      });
    } catch (error) {
      console.error(`Failed to create message: ${error}`);
      throw error;
    }
  }

  /**
   * Verifies the authenticity of a message using a digital signature.
   **/
  async verify<Body>(params: VerifyParams) {
    const currentSigningKey = this.currentSigningKey;
    const nextSigningKey = this.nextSigningKey;

    if (!currentSigningKey) {
      throw new Error('QSTASH_CURRENT_SIGNING_KEY is required');
    }

    if (!nextSigningKey) {
      throw new Error('QSTASH_NEXT_SIGNING_KEY is required');
    }

    const receiver = new Receiver({
      currentSigningKey,
      nextSigningKey,
    });

    const isValid = await receiver.verify(params);

    if (!isValid) {
      throw new Error('Invalid signature');
    }

    return JSON.parse(params.body) as Body;
  }

  private createClient() {
    const token = this.token;

    if (!token) {
      throw new Error('QSTASH_TOKEN is required');
    }

    return new Client({
      token,
    });
  }
}