import { NextRequest, NextResponse } from "next/server";
import supabase from "@/utils/supabase";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const google_id = searchParams.get('google_id');

        // Validate required parameter
        if (!google_id) {
            return NextResponse.json(
                {
                    data: null,
                    error: "google_id parameter is required",
                    status: 400
                },
                { status: 400 }
            );
        }

        // Query user from database
        const { data, error } = await supabase
            .from('users')
            .select('username, picture, is_verified, wallet_address, name, email')
            .eq('google_id', google_id)
            .single();

        // Handle database errors
        if (error) {
            console.error('Database error:', error);
            
            // Handle specific "no rows returned" error
            if (error.code === 'PGRST116') {
                return NextResponse.json(
                    {
                        data: null,
                        error: "User not found",
                        status: 404
                    },
                    { status: 404 }
                );
            }

            // Handle other database errors
            return NextResponse.json(
                {
                    data: null,
                    error: "Internal server error",
                    status: 500
                },
                { status: 500 }
            );
        }

        // Return successful response
        const { username, picture, is_verified, wallet_address, name, email } = data;

        return NextResponse.json(
            {
                data: {
                    username,
                    picture,
                    is_verified,
                    wallet_address,
                    name,
                    email
                },
                error: null,
                status: 200
            },
            { status: 200 }
        );

    } catch (error) {
        console.error('Unexpected error:', error);
        return NextResponse.json(
            {
                data: null,
                error: "Internal server error",
                status: 500
            },
            { status: 500 }
        );
    }
}