import { Controller, Get, Query } from '@nestjs/common';

@Controller()
export class PlacesController {
  @Get('autocomplete')
  async autocomplete(@Query('input') input?: string) {
    if (!input) {
      return { error: 'Missing input parameter' };
    }
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return { error: 'Missing GOOGLE_API_KEY' };
    }
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
      input,
    )}&key=${apiKey}&language=he&components=country:il`;
    const response = await fetch(url);
    const data = (await response.json()) as any;
    if (data.status !== 'OK') {
      return { error: data.status, message: data.error_message };
    }
    return data.predictions;
  }

  @Get('place-details')
  async placeDetails(@Query('place_id') placeId?: string) {
    if (!placeId) {
      return { error: 'Missing place_id parameter' };
    }
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return { error: 'Missing GOOGLE_API_KEY' };
    }
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&language=he`;
    const response = await fetch(url);
    const data = (await response.json()) as any;
    if (data.status !== 'OK') {
      return { error: data.status, message: data.error_message };
    }
    return data.result;
  }
}


