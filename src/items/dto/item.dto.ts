import { IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertItemDto {
  @IsString()
  id!: string; // itemId

  @IsString()
  userId!: string;

  @IsObject()
  data!: Record<string, unknown>;
}

export class QueryByUserDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  q?: string;
}


