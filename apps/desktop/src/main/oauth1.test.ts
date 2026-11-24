import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { baseUrl, pct, sign } from './oauth1'

describe('OAuth 1.0 (RFC 5849)', () => {
  it('exemplo da seção 1.2 da RFC (HMAC-SHA1, GET com query)', () => {
    const r = sign(
      {
        consumerKey: 'dpf43f3p2l4k3l03',
        consumerSecret: 'kd94hf93k423kf44',
        token: 'nnch734d00sl2jdk',
        tokenSecret: 'pfkkdhi9sl3r4s00',
        signatureMethod: 'HMAC-SHA1',
        timestamp: '137131202',
        nonce: 'chapoH'
      },
      { method: 'GET', url: new URL('http://photos.example.net/photos?file=vacation.jpg&size=original') }
    )
    expect(r.signature).toBe('MdpQcU8iPSUjWoN/UDMsK2sui9I=')
  })

  it('base string da seção 3.4.1.1 (POST com corpo de formulário e query repetida)', () => {
    const r = sign(
      {
        consumerKey: '9djdj82h48djs9d2',
        consumerSecret: 'j49sk3j29djd',
        token: 'kkk9d7dh3k39sjv7',
        tokenSecret: 'dh893hdasih9',
        signatureMethod: 'HMAC-SHA1',
        timestamp: '137131201',
        nonce: '7d8f3e4a'
      },
      { method: 'POST', url: new URL('http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b'), formBody: 'c2&a3=2+q' }
    )
    expect(r.baseString).toBe(
      'POST&http%3A%2F%2Fexample.com%2Frequest&a2%3Dr%2520b%26a3%3D2%2520q%26a3%3Da%26b5%3D%253D%25253D%26c%2540%3D%26c2%3D%26oauth_consumer_key%3D9djdj82h48djs9d2%26oauth_nonce%3D7d8f3e4a%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D137131201%26oauth_token%3Dkkk9d7dh3k39sjv7'
    )
  })

  it('exemplo documentado do Twitter (POST com corpo, assinatura conhecida)', () => {
    const r = sign(
      {
        consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
        consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
        signatureMethod: 'HMAC-SHA1',
        timestamp: '1318622958',
        nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
        version: '1.0'
      },
      {
        method: 'POST',
        url: new URL('https://api.twitter.com/1.1/statuses/update.json?include_entities=true'),
        formBody: 'status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21'
      }
    )
    expect(r.signature).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
    expect(r.header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"')
  })

  it('PLAINTEXT, realm no header e porta padrão fora da URL base', () => {
    const r = sign(
      { consumerKey: 'ck', consumerSecret: 'c&s', tokenSecret: 't s', signatureMethod: 'PLAINTEXT', timestamp: '1', nonce: 'n', realm: 'Photos' },
      { method: 'get', url: new URL('HTTPS://Example.COM:443/a?x=1') }
    )
    expect(r.signature).toBe('c%26s&t%20s')
    expect(r.header.startsWith('OAuth realm="Photos",oauth_consumer_key="ck"')).toBe(true)
    expect(baseUrl(new URL('http://EX.com:8080/p?q'))).toBe('http://ex.com:8080/p')
    expect(pct("a!'()*b")).toBe('a%21%27%28%29%2Ab')
  })

  it('RSA-SHA256 confere com a chave pública e body hash', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const r = sign(
      {
        consumerKey: 'ck',
        consumerSecret: '',
        signatureMethod: 'RSA-SHA256',
        timestamp: '1',
        nonce: 'n',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        includeBodyHash: true
      },
      { method: 'POST', url: new URL('https://x.local/y'), rawBody: Buffer.from('{"a":1}') }
    )
    expect(createVerify('RSA-SHA256').update(r.baseString).verify(publicKey, r.signature, 'base64')).toBe(true)
    expect(r.oauthParams.find(([k]) => k === 'oauth_body_hash')?.[1]).toBe('AVq9f1zFei3ZS3WQ8ErYCEJzkF7jPsXOvq5iJ2qX+GI=')
  })
})
