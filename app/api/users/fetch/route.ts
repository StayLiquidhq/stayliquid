import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
    try {
        // Validate environment variables
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            console.error('Missing required environment variables');
            return NextResponse.json(
                { 
                    error: 'Server configuration error', 
                    data: null 
                }, 
                { status: 500 }
            );
        }

        // Create Supabase client
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Fetch users data
        const { data, error } = await supabase
            .from('users')
            .select('*');

        // Handle database errors
        if (error) {
            console.error('Database error:', error);
            return NextResponse.json(
                { 
                    error: 'Failed to fetch users', 
                    data: null 
                }, 
                { status: 500 }
            );
        }

        // Return successful response
        return NextResponse.json(
            {
                error: null,
                data: data,
                count: data?.length || 0
            },
            { status: 200 }
        );

    } catch (error) {
        console.error('Unexpected error:', error);
        return NextResponse.json(
            { 
                error: 'Internal server error', 
                data: null 
            }, 
            { status: 500 }
        );
    }
}