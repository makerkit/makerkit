# QStash

A simple wrapper around the [QStash SDK](https://github.com/upstash/sdk-qstash-ts).

## Installation

```bash
npm i @makerkit/qstash
```

Provide some defaults for your QStash instance using environment variables:

```bash
QSTASH_TOKEN=*******
QSTASH_CURRENT_SIGNING_KEY=*******
QSTASH_NEXT_SIGNING_KEY=*******
```

Alternatively, you can provide these values when instantiating the Queue:

```ts
import { QStashTaskQueue } from '@makerkit/qstash';

const queue = new QStashTaskQueue({
  url: `https://yourapp.com/jobs`,
  token: `*****`,
  currentSigningKey: `*****`,
  nextSigningKey: `*****`,
});
```

## Usage

To create a new queue create, simply call `queue.create()`:

```tsx
import { QStashTaskQueue } from '@makerkit/qstash';

function createQueueJob() {
  const queue = new QStashTaskQueue({
    url: `https://yourapp.com/jobs`
  });

  queue.create({
    body: {
      type: 'email',
      to: 'info@makerkit.dev',
      subject: 'Hello from QStash',
    }
  });
}
```

To verify the signature of a request, use the `queue.verify()` method. 

```tsx
import { NextRequest, NextResponse } from 'next/server';

export const POST = async (reques: NextRequest) => {
  const queue = new QStashTaskQueue({
    url: `https://yourapp.com/jobs`,
    token: `*****`,
    currentSigningKey: `*****`,
    nextSigningKey: `*****`,
  });

  try {
    const body = await request.text();
    const signature = request.headers.get('Upstash-Signature');

    if (!signature) {
      throw new Error('Missing Upstash-Signature header');
    }

    return this.queue.verify({
      body,
      signature,
    });
  } catch (error) {
    return NextResponse.error(error);
  }

  // Do something with the request body
  const { body } = req.body;

  // Return a response
  return NextResponse.json({ 
    success: true,
  });
};
```

You can avoid the boilerplate by using the `verifyQStashRequest` helper:

```tsx
import { verifyQStashRequest } from '@makerkit/qstash';

export const POST = async (request: NextRequest) => {
  const queue = new QStashTaskQueue({
    url: `https://yourapp.com/jobs`,
    token: `*****`,
    currentSigningKey: `*****`,
    nextSigningKey: `*****`,
  });
  
  try {
    await verifyQStashRequest(request, queue);
  } catch (error) {
    return NextResponse.error(error);
  }

  const body = req.json();
  // Do something with the request body

  // Return a response
  return NextResponse.json({ 
    success: true,
  });
};
```

This works as long as the `request` object implements the standard `Request` interface. This is the case for Next.js App Router and Remix.

Otherwise, simply use the above example and pass the request body and signature manually.

#### Reusing a queue

To reuse an instance of the queue, simply export it from a module:

```tsx
import { QStashTaskQueue } from '@makerkit/qstash';

export const EmailsQueue = new QStashTaskQueue({
  url: `https://yourapp.com/jobs`,
  token: `*****`,
  currentSigningKey: `*****`,
  nextSigningKey: `*****`,
});
```

You can now import the queue and use it to create jobs:

```tsx
import { EmailsQueue } from './queues';

function createQueueJob(params) {
  return EmailsQueue.create({
    body: {
      type: 'email',
      to: ''
    }
  });
}
```

And verify requests, you can use the `verifyQStashRequest` helper:

```tsx
import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashRequest } from '@makerkit/qstash';
import { EmailsQueue } from './queues';

export const POST = async (request: NextRequest) => {
  try {
    await verifyQStashRequest(request, EmailsQueue);
  } catch (error) {
    return NextResponse.error(error);
  }

  const body = req.json();
  // Do something with the request body

  // Return a response
  return NextResponse.json({ 
    success: true,
  });
};
```

You can also do so from a Remix Action:

```tsx
import { json, ActionFunctionArgs } from '@remix-run/node';
import { EmailsQueue } from './queues';

export async function action(args: ActionFunctionArgs) {
  try {
    await verifyQStashRequest(args.request, EmailsQueue);
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }

  const body = req.json();
  // Do something with the request body
  
  // Return a response
  return json({ 
    success: true,
  });
}
```