import { FastifyRequest } from 'fastify'
import '@fastify/jwt'

export async function authenticate(request: FastifyRequest) {
  await request.jwtVerify()
}
