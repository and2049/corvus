export class Reader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  remaining(): number {
    return this.buffer.length - this.offset
  }

  hasRemaining(): boolean {
    return this.remaining() > 0
  }

  u8(): number {
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  u32(): number {
    const value = this.buffer.readUInt32LE(this.offset)
    this.offset += 4
    return value
  }

  u64(): bigint {
    const value = this.buffer.readBigUInt64LE(this.offset)
    this.offset += 8
    return value
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  string(): string {
    const length = this.u32()
    const value = this.buffer.subarray(this.offset, this.offset + length).toString("utf8")
    this.offset += length
    return value
  }

  raw(length: number): Buffer {
    const value = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  ip(): string {
    const raw = this.u32()
    return [raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff, (raw >>> 24) & 0xff].join(".")
  }

  fileSize(): number {
    if (this.buffer[this.offset + 7] === 255) {
      // Soulseek NS bug: >2 GiB sizes carry garbage in the upper 4 bytes
      const size = this.u32()
      this.offset += 4
      return size
    }
    return Number(this.u64())
  }
}

export class Writer {
  private readonly chunks: Buffer[] = []

  u8(value: number): this {
    this.chunks.push(Buffer.from([value & 0xff]))
    return this
  }

  u32(value: number): this {
    const buf = Buffer.alloc(4)
    buf.writeUInt32LE(value >>> 0, 0)
    this.chunks.push(buf)
    return this
  }

  u64(value: number | bigint): this {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(BigInt(value), 0)
    this.chunks.push(buf)
    return this
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0)
  }

  string(value: string): this {
    this.u32(Buffer.byteLength(value, "utf8"))
    this.chunks.push(Buffer.from(value, "utf8"))
    return this
  }

  bytes(value: Buffer): this {
    this.chunks.push(value)
    return this
  }

  build(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

// A framed message: uint32 size (counting code + payload), then the message body.
export function frame(body: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
}

export function codeBody(code: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt32LE(code, 0)
  return Buffer.concat([head, payload])
}
