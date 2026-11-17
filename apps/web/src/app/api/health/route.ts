import { healthResponse } from '@kavach/shared';

export function GET(): Response {
  return Response.json(healthResponse('web'));
}
